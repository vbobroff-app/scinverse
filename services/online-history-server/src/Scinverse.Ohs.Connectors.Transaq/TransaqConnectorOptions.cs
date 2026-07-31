namespace Scinverse.Ohs.Connectors.Transaq;

/// <summary>Параметры подключения к TRANSAQ Connector.</summary>
public sealed class TransaqConnectorOptions
{
    public const string SectionName = "Transaq";

    /// <summary>Путь к txmlconnector.dll (битность обязана совпадать с процессом).</summary>
    public string DllPath { get; set; } = "txmlconnector.dll";

    /// <summary>Логин TRANSAQ. Только из user-secrets/переменных окружения, не из appsettings.json.</summary>
    public string Login { get; set; } = string.Empty;

    /// <summary>Пароль TRANSAQ. Только из user-secrets/переменных окружения, не из appsettings.json.</summary>
    public string Password { get; set; } = string.Empty;
    public string Host { get; set; } = string.Empty;
    public int Port { get; set; }

    public string LogDir { get; set; } = "logs/transaq";
    public int LogLevel { get; set; } = 2;

    /// <summary>
    /// Таймаут ожидания асинхронного подтверждения соединения
    /// (колбэк server_status connected="true") после отправки команды connect.
    /// </summary>
    public int ConnectTimeoutSeconds { get; set; } = 30;

    /// <summary>
    /// <c>&lt;request_timeout&gt;</c> в команде connect (сек), параметр DLL TRANSAQ.
    /// Эксперимент: дефолт был 20 — совпадало с дыркой cut→Degraded на кабеле/Wi‑Fi.
    /// </summary>
    public int RequestTimeoutSeconds { get; set; } = 10;

    /// <summary>
    /// Таймаут активного пинга <c>get_servtime_difference</c> (сек). При обрыве кабеля/Wi‑Fi
    /// SendCommand может висеть ~20–50 с (TCP / request_timeout) и вернуть stale success —
    /// без таймаута stall-детект бесполезен, UI ждёт server_status. 3 с ≈ RTT Finam с запасом.
    /// </summary>
    public int ProbeTimeoutSeconds { get; set; } = 3;
}
