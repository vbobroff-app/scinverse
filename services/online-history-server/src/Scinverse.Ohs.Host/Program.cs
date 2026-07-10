using Npgsql;
using Scinverse.Ohs.Connectors.Transaq;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Host;
using Scinverse.Ohs.Ingestion;
using Scinverse.Ohs.Storage.Timescale;
using Serilog;

var builder = WebApplication.CreateBuilder(args);

// Неверсионируемый локальный конфиг (dev-машина): креды коннектора, Host/Port, GapThreshold.
// Файл в .gitignore; имеет приоритет над appsettings.json.
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: true);

builder.Services.AddSerilog((services, loggerConfiguration) => loggerConfiguration
    .ReadFrom.Configuration(builder.Configuration)
    .ReadFrom.Services(services)
    .Enrich.FromLogContext());

var ohsOptions = builder.Configuration.GetSection(OhsOptions.SectionName).Get<OhsOptions>() ?? new OhsOptions();
var batcherOptions = builder.Configuration.GetSection(TradeBatcherOptions.SectionName).Get<TradeBatcherOptions>() ?? new TradeBatcherOptions();

builder.Services.AddSingleton(ohsOptions);
builder.Services.AddSingleton(batcherOptions);

var connectionString = builder.Configuration.GetConnectionString("Timescale")
    ?? "Host=localhost;Port=5432;Database=scinverse;Username=scinverse;Password=scinverse";
builder.Services.AddSingleton(_ => new NpgsqlDataSourceBuilder(connectionString).Build());

// Инфраструктура домена/хранилища.
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<IInstrumentStore, InstrumentStore>();
builder.Services.AddSingleton<ISourceStore, SourceStore>();
builder.Services.AddSingleton<ICoverageStore, CoverageStore>();
builder.Services.AddSingleton<IConnectionStore, ConnectionStore>();
builder.Services.AddSingleton<ITradeWriter, TimescaleTradeWriter>();
builder.Services.AddSingleton<IDerivativeSpecParser, MoexFortsSpecParser>();
builder.Services.AddSingleton<IInstrumentRegistry, InstrumentRegistry>();
builder.Services.AddSingleton<TradeNormalizer>();
builder.Services.AddSingleton<TradeBatcher>();
builder.Services.AddSingleton<ITransaqParser, TransaqXmlParser>();

// Коннекторы: фабрика по kind + in-memory креды (секреты в БД не хранятся).
builder.Services.AddSingleton<IConnectorFactory, ConnectorFactory>();
builder.Services.AddSingleton<ICredentialStore, InMemoryCredentialStore>();

// Control-plane.
builder.Services.AddSingleton<WebSocketBroadcaster>();
builder.Services.AddSingleton<CoverageTracker>();
builder.Services.AddSingleton<ConnectionManager>();
builder.Services.AddSingleton<RecordingManager>();
builder.Services.AddHostedService<OhsWorker>();

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddCors(options => options.AddPolicy("admin-dev", policy =>
{
    if (!string.IsNullOrWhiteSpace(ohsOptions.AdminOrigin))
    {
        policy.WithOrigins(ohsOptions.AdminOrigin).AllowAnyHeader().AllowAnyMethod();
    }
    else
    {
        policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod();
    }
}));

var app = builder.Build();

app.UseSerilogRequestLogging();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors("admin-dev");
app.UseWebSockets();

app.MapGet("/healthz", () => Results.Ok(new { status = "ok" }));

app.Map("/ws", async (HttpContext context, WebSocketBroadcaster broadcaster) =>
{
    if (!context.WebSockets.IsWebSocketRequest)
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        return;
    }

    using var socket = await context.WebSockets.AcceptWebSocketAsync();
    await broadcaster.HandleAsync(socket, context.RequestAborted);
});

app.MapOhsApi();

// Прогреваем реестр инструментов до старта приёма запросов (команды записи резолвят инструмент).
await app.Services.GetRequiredService<IInstrumentRegistry>().InitializeAsync(CancellationToken.None);

app.Run();

// Точка входа доступна тестам (WebApplicationFactory<Program>).
public partial class Program;
