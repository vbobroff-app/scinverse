using Npgsql;
using Scinverse.Db.Migrator;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Storage.Timescale;
using Testcontainers.PostgreSql;

namespace Scinverse.Ohs.IntegrationTests;

/// <summary>
/// Поднимает эфемерный TimescaleDB в контейнере, прогоняет реальные миграции (DbUp)
/// и сидит один справочный инструмент (нужен для FK md_trade → instrument).
/// Один контейнер на класс тестов; между тестами таблица усекается.
/// </summary>
public sealed class TimescaleFixture : IAsyncLifetime
{
    // Пиннинг версии — воспроизводимость CI. Нужен именно образ TimescaleDB
    // (ванильный postgres не знает CREATE EXTENSION timescaledb / create_hypertable).
    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder()
        .WithImage("timescale/timescaledb:2.17.2-pg16")
        .WithDatabase("scinverse")
        .WithUsername("scinverse")
        .WithPassword("scinverse")
        .Build();

    public NpgsqlDataSource DataSource { get; private set; } = null!;

    public long InstrumentId { get; private set; }

    public async Task InitializeAsync()
    {
        await _container.StartAsync();

        var connectionString = _container.GetConnectionString();

        var result = DatabaseMigrator.Run(connectionString);
        if (!result.Successful)
        {
            throw new InvalidOperationException("Прогон миграций не удался", result.Error);
        }

        DataSource = new NpgsqlDataSourceBuilder(connectionString).Build();

        var store = new InstrumentStore(DataSource);
        var instrument = await store.UpsertAsync(
            new SecurityInfo
            {
                Key = new InstrumentKey("SBER", "TQBR"),
                MinStep = 0.01m,
                Decimals = 2
            },
            CancellationToken.None);

        InstrumentId = instrument.InstrumentId;
    }

    public async Task DisposeAsync()
    {
        if (DataSource is not null)
        {
            await DataSource.DisposeAsync();
        }

        await _container.DisposeAsync();
    }
}
