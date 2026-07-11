namespace Scinverse.Ohs.Domain;

/// <summary>
/// Присутствие сделок по временны́м бакетам (слой сделок на Ганте покрытия): какие бакеты
/// содержат хотя бы одну сделку. Показатель качественный (есть/нет), без объёма/количества.
/// </summary>
public interface ITradeActivityStore
{
    /// <summary>
    /// Непустые бакеты (шаг <paramref name="bucket"/>) для инструментов <paramref name="instrumentIds"/>
    /// в окне [<paramref name="from"/>, <paramref name="to"/>) по источнику <paramref name="sourceId"/>.
    /// Возвращает по одному <see cref="InstrumentActivity"/> на каждый запрошенный инструмент
    /// (для инструментов без сделок — пустой список бакетов).
    /// </summary>
    Task<IReadOnlyList<InstrumentActivity>> QueryActivityAsync(
        IReadOnlyCollection<long> instrumentIds, short sourceId,
        DateTimeOffset from, DateTimeOffset to, TimeSpan bucket, CancellationToken cancellationToken);
}

/// <summary>Присутствие сделок одного инструмента: старты непустых бакетов (по возрастанию).</summary>
public sealed record InstrumentActivity
{
    public required long InstrumentId { get; init; }
    public required IReadOnlyList<DateTimeOffset> Buckets { get; init; }
}
