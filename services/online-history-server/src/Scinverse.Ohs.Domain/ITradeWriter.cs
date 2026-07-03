namespace Scinverse.Ohs.Domain;

/// <summary>Порт пакетной записи сделок (реализация — Storage.Timescale, Npgsql COPY).</summary>
public interface ITradeWriter
{
    /// <summary>Пишет батч сделок; возвращает число фактически вставленных строк (после дедупликации).</summary>
    Task<int> WriteAsync(IReadOnlyCollection<TradeRecord> trades, CancellationToken cancellationToken);
}
