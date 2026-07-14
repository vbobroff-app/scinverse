namespace Scinverse.Ohs.Contracts;

/// <summary>
/// Типизированный контракт REST API OHS. Сервер реализует те же маршруты на Minimal API;
/// согласованность держится интеграционными тестами (клиент бьёт по реальному хосту).
/// Комментарии рядом с методами фиксируют HTTP-маршрут (source-generator не используется —
/// клиент реализован вручную на <c>HttpClient</c>, см. Scinverse.Ohs.ApiTests).
/// </summary>
public interface IOhsApi
{
    /// <summary>GET /api/instruments?q=&amp;board=&amp;secType=&amp;category=&amp;onlyRecording=&amp;nonEmpty=&amp;instrumentIds=&amp;exchanges=&amp;underlyingId=&amp;expiration=&amp;limit=&amp;offset=</summary>
    Task<InstrumentPageDto> GetInstrumentsAsync(
        InstrumentQueryParams query, CancellationToken cancellationToken = default);

    /// <summary>GET /api/instruments/groups?level=series&amp;underlyingId=</summary>
    Task<IReadOnlyList<InstrumentGroupDto>> GetInstrumentGroupsAsync(
        string level, long? underlyingId = null, CancellationToken cancellationToken = default);

    /// <summary>GET /api/sources</summary>
    Task<IReadOnlyList<SourceDto>> GetSourcesAsync(CancellationToken cancellationToken = default);

    /// <summary>GET /api/sessions?count=&amp;includeWeekends=</summary>
    Task<IReadOnlyList<SessionDto>> GetSessionsAsync(
        int count, bool includeWeekends, CancellationToken cancellationToken = default);

    /// <summary>GET /api/coverage/extent?sourceId=</summary>
    Task<CoverageExtentDto> GetCoverageExtentAsync(
        short? sourceId = null, CancellationToken cancellationToken = default);

    /// <summary>GET /api/coverage?from={from}&amp;to={to}</summary>
    Task<IReadOnlyList<CoverageSegmentDto>> GetCoverageAsync(
        DateTimeOffset from, DateTimeOffset to, CancellationToken cancellationToken = default);

    /// <summary>POST /api/coverage/activity — присутствие сделок по бакетам (слой сделок).</summary>
    Task<IReadOnlyList<TradeActivityDto>> GetTradeActivityAsync(
        TradeActivityRequest request, CancellationToken cancellationToken = default);

    /// <summary>GET /api/recordings</summary>
    Task<IReadOnlyList<RecordingDto>> GetRecordingsAsync(CancellationToken cancellationToken = default);

    /// <summary>POST /api/recordings</summary>
    Task<RecordingDto> StartRecordingAsync(StartRecordingRequest request, CancellationToken cancellationToken = default);

    /// <summary>DELETE /api/recordings/{instrumentId}</summary>
    Task StopRecordingAsync(long instrumentId, CancellationToken cancellationToken = default);

    /// <summary>GET /api/recording/schedule</summary>
    Task<IReadOnlyList<RecordingScheduleDto>> GetRecordingScheduleAsync(
        CancellationToken cancellationToken = default);

    /// <summary>PUT /api/recording/schedule</summary>
    Task<IReadOnlyList<RecordingScheduleDto>> UpsertRecordingScheduleAsync(
        UpsertRecordingScheduleRequest request, CancellationToken cancellationToken = default);

    /// <summary>GET /api/connections</summary>
    Task<IReadOnlyList<ConnectionDto>> GetConnectionsAsync(CancellationToken cancellationToken = default);

    /// <summary>POST /api/connections</summary>
    Task<ConnectionDto> UpsertConnectionAsync(UpsertConnectionRequest request, CancellationToken cancellationToken = default);

    /// <summary>PUT /api/connections/{id}/credentials</summary>
    Task SetCredentialsAsync(long id, ConnectionCredentialsRequest request, CancellationToken cancellationToken = default);

    /// <summary>POST /api/connections/{id}/connect</summary>
    Task<ConnectionDto> ConnectConnectionAsync(long id, CancellationToken cancellationToken = default);

    /// <summary>POST /api/connections/{id}/disconnect</summary>
    Task<ConnectionDto> DisconnectConnectionAsync(long id, CancellationToken cancellationToken = default);

    /// <summary>POST /api/connections/{id}/test</summary>
    Task<ConnectionDto> TestConnectionAsync(long id, CancellationToken cancellationToken = default);

    /// <summary>GET /api/exchanges/engines — движки биржи (MOEX ISS).</summary>
    Task<IReadOnlyList<EngineDto>> GetEnginesAsync(CancellationToken cancellationToken = default);

    /// <summary>GET /api/exchanges/{engine}/markets</summary>
    Task<IReadOnlyList<MarketDto>> GetMarketsAsync(string engine, CancellationToken cancellationToken = default);

    /// <summary>GET /api/exchanges/{engine}/{market}/boards</summary>
    Task<IReadOnlyList<BoardDto>> GetBoardsAsync(
        string engine, string market, CancellationToken cancellationToken = default);

    /// <summary>GET /api/exchanges/{engine}/{market}/{board}/securities</summary>
    Task<IReadOnlyList<IssSecurityDto>> GetBoardSecuritiesAsync(
        string engine, string market, string board, CancellationToken cancellationToken = default);

    /// <summary>GET /api/exchanges/asset-classes — справочник классов базового актива фьючерсов.</summary>
    Task<IReadOnlyList<FuturesAssetClassDto>> GetAssetClassesAsync(CancellationToken cancellationToken = default);

    /// <summary>POST /api/exchanges/asset-classes/refresh — актуализация справочника из ISS (по кнопке).</summary>
    Task<AssetClassRefreshResultDto> RefreshAssetClassesAsync(CancellationToken cancellationToken = default);

    /// <summary>GET /api/exchanges/{engine}/calendar?from=&amp;till= — торговый календарь движка (ISS).</summary>
    Task<IReadOnlyList<CalendarDayDto>> GetEngineCalendarAsync(
        string engine, DateOnly? from = null, DateOnly? till = null, CancellationToken cancellationToken = default);

    /// <summary>GET /api/exchanges/{engine}/schedule?on= — действующее на дату расписание движка (market_schedule).</summary>
    Task<MarketScheduleDto?> GetMarketScheduleAsync(
        string engine, DateOnly? on = null, CancellationToken cancellationToken = default);
}
