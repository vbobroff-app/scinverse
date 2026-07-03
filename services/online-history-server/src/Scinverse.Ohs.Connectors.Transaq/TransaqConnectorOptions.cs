namespace Scinverse.Ohs.Connectors.Transaq;

/// <summary>Параметры подключения к TRANSAQ Connector.</summary>
public sealed class TransaqConnectorOptions
{
    public const string SectionName = "Transaq";

    /// <summary>Путь к txmlconnector.dll (битность обязана совпадать с процессом).</summary>
    public string DllPath { get; set; } = "txmlconnector.dll";

    public string Login { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
    public string Host { get; set; } = string.Empty;
    public int Port { get; set; }

    public string LogDir { get; set; } = "logs/transaq";
    public int LogLevel { get; set; } = 2;
}
