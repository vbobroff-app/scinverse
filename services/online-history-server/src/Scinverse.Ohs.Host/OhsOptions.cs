namespace Scinverse.Ohs.Host;

/// <summary>Параметры хоста OHS.</summary>
public sealed class OhsOptions
{
    public const string SectionName = "Ohs";

    /// <summary>Использовать демо-коннектор (без нативной txmlconnector.dll).</summary>
    public bool UseFakeConnector { get; set; } = true;

    /// <summary>Инструменты для подписки на ленту сделок.</summary>
    public IList<InstrumentRef> Instruments { get; } = new List<InstrumentRef>();
}

/// <summary>Ссылка на инструмент в конфигурации.</summary>
public sealed class InstrumentRef
{
    public string Seccode { get; set; } = string.Empty;
    public string Board { get; set; } = string.Empty;
}
