namespace Scinverse.Ohs.Ingestion;

/// <summary>Параметры буферизации записи сделок.</summary>
public sealed class TradeBatcherOptions
{
    public const string SectionName = "Batcher";

    /// <summary>Максимальный размер батча для записи.</summary>
    public int BatchSize { get; set; } = 5000;

    /// <summary>Максимальная задержка перед сбросом неполного батча.</summary>
    public TimeSpan FlushInterval { get; set; } = TimeSpan.FromMilliseconds(500);

    /// <summary>Ёмкость очереди (backpressure: продюсер ждёт при заполнении).</summary>
    public int Capacity { get; set; } = 100_000;
}
