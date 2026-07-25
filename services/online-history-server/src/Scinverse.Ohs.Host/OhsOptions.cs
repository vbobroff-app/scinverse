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
    /// Дедлайн передачи владения инцидентом связи от TRANSAQ к супервизору (сек), phase 7j.20 (J3/J8).
    /// Пока связь в <c>Degraded</c> (TRANSAQ сам чинит линк ①) дольше этого порога — супервизор форс-гасит
    /// залипшую сессию и берёт восстановление на себя (connect ×5, плечо ②). Инцидент НЕ закрывается.
    /// Это НЕ порог детекции (инцидент уже открыт с 0 c) — только момент смены владельца.
    /// </summary>
    public double LinkRecoverGraceSeconds { get; set; } = 60;

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
