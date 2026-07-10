using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Npgsql;
using Scinverse.Db.Migrator;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Storage.Timescale;
using Testcontainers.PostgreSql;

namespace Scinverse.Ohs.ApiTests;

/// <summary>
/// Поднимает эфемерный TimescaleDB (Testcontainers), прогоняет миграции, сидит инструмент SBER,
/// и запускает реальный OHS-хост через <see cref="WebApplicationFactory{TEntryPoint}"/> с
/// переопределённой строкой подключения. Один контейнер на класс тестов.
/// </summary>
public sealed class OhsApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder()
        .WithImage("timescale/timescaledb:2.17.2-pg16")
        .WithDatabase("scinverse")
        .WithUsername("scinverse")
        .WithPassword("scinverse")
        .Build();

    private string _connectionString = string.Empty;

    public long SberInstrumentId { get; private set; }

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        _connectionString = _container.GetConnectionString();

        var result = DatabaseMigrator.Run(_connectionString);
        if (!result.Successful)
        {
            throw new InvalidOperationException("Прогон миграций не удался", result.Error);
        }

        await using var dataSource = new NpgsqlDataSourceBuilder(_connectionString).Build();
        var instrumentStore = new InstrumentStore(dataSource);
        var sber = await instrumentStore.UpsertAsync(
            new SecurityInfo
            {
                Key = new InstrumentKey("SBER", "TQBR"),
                MinStep = 0.01m,
                Decimals = 2
            },
            CancellationToken.None);

        SberInstrumentId = sber.InstrumentId;

        // Сид цепочки FORTS для проверки группировки (derivative + /api/instruments/groups).
        var parser = new MoexFortsSpecParser();
        var asOf = DateOnly.FromDateTime(DateTime.UtcNow);
        foreach (var (ticker, board, secType) in new[]
                 {
                     ("SiU6", "FUT", "FUT"),
                     ("SiU6C65000", "OPT", "OPT"),
                     ("SiU6P65000", "OPT", "OPT")
                 })
        {
            var key = new InstrumentKey(ticker, board);
            var security = new SecurityInfo { Key = key, MinStep = 1m, Decimals = 0, SecType = secType };
            if (parser.TryParse(key, secType, asOf, out var spec))
            {
                security = security with
                {
                    UnderlyingCode = spec.UnderlyingCode,
                    UnderlyingFuturesCode = spec.UnderlyingFuturesCode,
                    Expiration = spec.Expiration,
                    OptionType = spec.OptionType,
                    Strike = spec.Strike
                };
            }

            await instrumentStore.UpsertAsync(security, CancellationToken.None);
        }
    }

    public new async Task DisposeAsync()
    {
        await base.DisposeAsync();
        await _container.DisposeAsync();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Production");
        builder.ConfigureAppConfiguration((_, configuration) =>
        {
            configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Timescale"] = _connectionString
            });
        });

        // Хост читает строку подключения в top-level Program до применения конфигурации фабрики
        // (плюс appsettings.Local.json имеет приоритет), поэтому детерминированно подменяем сам
        // NpgsqlDataSource на эфемерный контейнер — тесты гермётичны и не зависят от dev-БД.
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<NpgsqlDataSource>();
            services.AddSingleton(_ => new NpgsqlDataSourceBuilder(_connectionString).Build());
        });
    }
}
