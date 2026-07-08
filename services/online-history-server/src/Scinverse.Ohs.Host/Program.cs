using Npgsql;
using Scinverse.Ohs.Connectors.Transaq;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Host;
using Scinverse.Ohs.Ingestion;
using Scinverse.Ohs.Storage.Timescale;
using Serilog;

var builder = Host.CreateApplicationBuilder(args);

// Неверсионируемый локальный конфиг (dev-машина): креды коннектора, Host/Port, UseFakeConnector.
// Файл в .gitignore; имеет приоритет над appsettings.json.
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: true);

builder.Services.AddSerilog((services, loggerConfiguration) => loggerConfiguration
    .ReadFrom.Configuration(builder.Configuration)
    .ReadFrom.Services(services)
    .Enrich.FromLogContext());

var ohsOptions = builder.Configuration.GetSection(OhsOptions.SectionName).Get<OhsOptions>() ?? new OhsOptions();
var transaqOptions = builder.Configuration.GetSection(TransaqConnectorOptions.SectionName).Get<TransaqConnectorOptions>() ?? new TransaqConnectorOptions();
var batcherOptions = builder.Configuration.GetSection(TradeBatcherOptions.SectionName).Get<TradeBatcherOptions>() ?? new TradeBatcherOptions();

builder.Services.AddSingleton(ohsOptions);
builder.Services.AddSingleton(transaqOptions);
builder.Services.AddSingleton(batcherOptions);

var connectionString = builder.Configuration.GetConnectionString("Timescale")
    ?? "Host=localhost;Port=5432;Database=scinverse;Username=scinverse;Password=scinverse";
builder.Services.AddSingleton(_ => new NpgsqlDataSourceBuilder(connectionString).Build());

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<IInstrumentStore, InstrumentStore>();
builder.Services.AddSingleton<ISourceStore, SourceStore>();
builder.Services.AddSingleton<ICoverageStore, CoverageStore>();
builder.Services.AddSingleton<IConnectionStore, ConnectionStore>();
builder.Services.AddSingleton<ITradeWriter, TimescaleTradeWriter>();
builder.Services.AddSingleton<IInstrumentRegistry, InstrumentRegistry>();
builder.Services.AddSingleton<RecordingManager>();
builder.Services.AddSingleton<TradeNormalizer>();
builder.Services.AddSingleton<TradeBatcher>();
builder.Services.AddSingleton<ITransaqParser, TransaqXmlParser>();

if (ohsOptions.UseFakeConnector)
{
    builder.Services.AddSingleton<IMarketConnector>(_ => new FakeReplayConnector(SampleData.Generate(ohsOptions)));
}
else
{
    builder.Services.AddSingleton<IMarketConnector>(sp => new TransaqConnector(sp.GetRequiredService<TransaqConnectorOptions>()));
}

builder.Services.AddHostedService<OhsWorker>();

var host = builder.Build();
host.Run();
