using Npgsql;
using Scinverse.Ohs.Connectors.Transaq;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Domain.Moex;
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
var transaqOptions = builder.Configuration.GetSection(TransaqConnectorOptions.SectionName).Get<TransaqConnectorOptions>()
    ?? new TransaqConnectorOptions();

builder.Services.AddSingleton(ohsOptions);
builder.Services.AddSingleton(batcherOptions);
builder.Services.AddSingleton(transaqOptions);

var connectionString = builder.Configuration.GetConnectionString("Timescale")
    ?? "Host=localhost;Port=5432;Database=scinverse;Username=scinverse;Password=scinverse";
builder.Services.AddSingleton(_ => new NpgsqlDataSourceBuilder(connectionString).Build());

// Инфраструктура домена/хранилища.
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<IInstrumentStore, InstrumentStore>();
builder.Services.AddSingleton<ISourceStore, SourceStore>();
builder.Services.AddSingleton<ICoverageStore, CoverageStore>();
builder.Services.AddSingleton<ITradeActivityStore, TradeActivityStore>();
builder.Services.AddSingleton<ICaptureLivenessStore, CaptureLivenessStore>();
builder.Services.AddSingleton<IConnectionStore, ConnectionStore>();
builder.Services.AddSingleton<IRecordingScheduleStore, RecordingScheduleStore>();
builder.Services.AddSingleton<IFuturesAssetClassStore, FuturesAssetClassStore>();
builder.Services.AddSingleton<IMarketScheduleStore, MarketScheduleStore>();
builder.Services.AddSingleton<IExternalServiceStore, ExternalServiceStore>();
builder.Services.AddSingleton<ITradeWriter, TimescaleTradeWriter>();
builder.Services.AddSingleton<IDerivativeSpecParser, MoexFortsSpecParser>();
builder.Services.AddSingleton<IInstrumentRegistry, InstrumentRegistry>();
builder.Services.AddSingleton<TradeNormalizer>();
builder.Services.AddSingleton<TradeBatcher>();
builder.Services.AddSingleton<ITransaqParser, TransaqXmlParser>();

// Коннекторы: фабрика по kind + in-memory креды (секреты в БД не хранятся).
builder.Services.AddSingleton<IConnectorFactory, ConnectorFactory>();
builder.Services.AddSingleton<ICredentialStore, InMemoryCredentialStore>();

// MOEX ISS: каталог структуры биржи (engines/markets/boards/securities) с кэшем в памяти.
builder.Services.AddMemoryCache();
builder.Services.AddHttpClient<IExchangeCatalog, IssExchangeCatalog>(client =>
{
    client.BaseAddress = new Uri(ohsOptions.IssBaseUrl);
    client.Timeout = TimeSpan.FromSeconds(15);
});
// Finam Trade API (интеграция-подтверждатель расписания, phase 7i): typed HttpClient + JWT-кэш.
builder.Services.AddHttpClient<Scinverse.Ohs.Domain.Finam.IFinamApi, Scinverse.Ohs.Host.Finam.FinamApiClient>(client =>
{
    client.BaseAddress = new Uri(ohsOptions.FinamBaseUrl);
    client.Timeout = TimeSpan.FromSeconds(15);
});
// Актуализация справочника классов базового актива фьючерсов из ISS (по кнопке).
builder.Services.AddSingleton<FuturesAssetClassifier>();
// Расписание сессий из бесплатного ISS-календаря движка (часы дней + праздники), фолбэк MoexSchedule.
builder.Services.AddSingleton<IMarketCalendar, MarketCalendar>();

// Control-plane.
builder.Services.AddSingleton<WebSocketBroadcaster>();
builder.Services.AddSingleton<CoverageTracker>();
builder.Services.AddSingleton<LivenessProbe>();
builder.Services.AddSingleton<ILivenessWriter>(sp => sp.GetRequiredService<LivenessProbe>());
builder.Services.AddSingleton(sp => new Lazy<ILivenessWriter>(() => sp.GetRequiredService<ILivenessWriter>()));
builder.Services.AddSingleton(sp => new Lazy<RecordingManager>(() => sp.GetRequiredService<RecordingManager>()));
builder.Services.AddSingleton<ConnectionManager>();
builder.Services.AddSingleton<RecordingManager>();
builder.Services.AddSingleton<RecordingSupervisor>();
// Pre-flight сверки расписания: transient — использует типизированный HttpClient IFinamApi (per-request).
builder.Services.AddTransient<SchedulePreflight>();
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

// Recovery (phase 7h): аккуратно закрываем «осиротевшие» открытые сегменты покрытия и интервалы
// живости прошлого процесса (аварийный рестарт), иначе подложка ложно «склеится» до now.
{
    using var recoveryScope = app.Logger.BeginScope("startup-recovery");
    var recoveredSegments = await app.Services.GetRequiredService<ICoverageStore>()
        .RecoverOpenSegmentsAsync(CancellationToken.None);
    var recoveredLiveness = await app.Services.GetRequiredService<ICaptureLivenessStore>()
        .RecoverOpenIntervalsAsync(CancellationToken.None);
    if (recoveredSegments > 0 || recoveredLiveness > 0)
    {
        app.Logger.LogWarning(
            "Recovery: закрыто осиротевших сегментов {Segments}, интервалов живости {Liveness}",
            recoveredSegments, recoveredLiveness);
    }
}

// ВРЕМЕННО (dev): креды Transaq из appsettings.Local.json → in-memory store (toggle после рестарта).
await DevLocalTransaqCredentials.SeedInMemoryStoreAsync(app.Services, app.Logger, CancellationToken.None);

app.Run();

// Точка входа доступна тестам (WebApplicationFactory<Program>).
public partial class Program;
