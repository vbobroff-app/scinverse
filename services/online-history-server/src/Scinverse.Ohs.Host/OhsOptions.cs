namespace Scinverse.Ohs.Host;

/// <summary>Параметры хоста OHS.</summary>
public sealed class OhsOptions
{
    public const string SectionName = "Ohs";

    /// <summary>Использовать демо-коннектор (без нативной txmlconnector.dll).</summary>
    public bool UseFakeConnector { get; set; } = true;

    /// <summary>Порог (сек) для детекции внутрисессионных разрывов на Ганте покрытия.</summary>
    public double GapThresholdSeconds { get; set; } = 60;

    /// <summary>
    /// Шаг опроса живости захвата (сек), phase 7h.2. По умолчанию 15 = min_bucket/2 (бакет 30 c).
    /// </summary>
    public double LivenessProbeSeconds { get; set; } = 15;

    /// <summary>
    /// T — макс. ожидание восстановления средствами TRANSAQ (сек), phase 7j.20 (J3/J8).
    /// Пока owner=<c>transaq</c> (Degraded / ping-stall, жёлтая лента) — ждём до T; по истечении owner→supervisor
    /// (красная лента, connect ×5). Раньше T TRANSAQ может сдаться (server_status Down/Error) —
    /// та же смена owner сразу. Не порог детекции: инцидент открыт с 0 c.
    /// </summary>
    public double LinkRecoverGraceSeconds { get; set; } = 60;

    /// <summary>
    /// Подтверждение Degraded перед open break (сек). ≤0 — сразу open (дефолт: приёмка/оператор
    /// видит разрыв без задержки). &gt;0 — debounce коротких recover-flap TRANSAQ (меньше зелёных
    /// маркеров на мигании ~1с).
    /// </summary>
    public double LinkDegradedConfirmSeconds { get; set; } = 0;

    /// <summary>
    /// Connect-grace барьера восстановления клиента на старте процесса (сек), phase 7j.20; ≤0 — барьер
    /// выключен. Столько ждём подключения хоть одного WS-клиента (WS доступен лишь через несколько секунд
    /// после старта Kestrel — с запасом на это). Никто не подключился ⇒ наблюдателя нет ⇒ Auto стартует.
    /// </summary>
    public double ClientRecoveryGraceSeconds { get; set; } = 25;

    /// <summary>
    /// Heads-up-grace барьера (сек), phase 7j.20. После подключения WS-клиента столько ждём heads-up
    /// (<c>POST /api/recovery/hold</c>) — признак открытого инцидента простоя. Нет heads-up ⇒ инцидента
    /// нет ⇒ Auto стартует. Покрывает задержку POST после open WS.
    /// </summary>
    public double ClientRecoveryHeadsUpSeconds { get; set; } = 8;

    /// <summary>
    /// Hold-grace барьера (сек), phase 7j.20. После heads-up ждём <c>backend.recovered</c> столько —
    /// инцидент, затянутый нестабильностью (втянутые 500), удерживает первый Auto до реального закрытия,
    /// а не до фикс-таймаута. Верхняя страховка, если recover так и не пришёл.
    /// </summary>
    public double ClientRecoveryHoldMaxSeconds { get; set; } = 90;

    /// <summary>Origin dev-фронта (Vite) для CORS-политики админки.</summary>
    public string? AdminOrigin { get; set; }

    /// <summary>Базовый URL публичного MOEX ISS (каталог структуры биржи, расписания).</summary>
    public string IssBaseUrl { get; set; } = "https://iss.moex.com/iss/";

    /// <summary>Базовый URL Finam Trade API (интеграция-подтверждатель расписания, phase 7i).</summary>
    public string FinamBaseUrl { get; set; } = "https://api.finam.ru";

    /// <summary>Инструменты для подписки на ленту сделок.</summary>
    public IList<InstrumentRef> Instruments { get; } = new List<InstrumentRef>();
}

/// <summary>Ссылка на инструмент в конфигурации.</summary>
public sealed class InstrumentRef
{
    public string Ticker { get; set; } = string.Empty;
    public string Board { get; set; } = string.Empty;
}
