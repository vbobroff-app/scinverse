namespace Scinverse.Ohs.Domain;

/// <summary>Запрос bracketing вокруг ядра WriteHole: last trade &lt; Before, first &gt; After в окне intention.</summary>
public sealed record TradeBracketRequest(
    long InstrumentId,
    DateTimeOffset WindowFrom,
    DateTimeOffset Before,
    DateTimeOffset After,
    DateTimeOffset WindowTo);

/// <summary>Ответ bracketing для одного ядра (ключи — InstrumentId + Before + After).</summary>
public sealed record TradeBracket(
    long InstrumentId,
    DateTimeOffset Before,
    DateTimeOffset After,
    DateTimeOffset? LastBefore,
    DateTimeOffset? FirstAfter);

/// <summary>Границы WriteHole из <c>md_trade</c> (не activity-бакеты).</summary>
public interface ITradeBracketStore
{
    /// <summary>
    /// Батч: для каждого запроса —
    /// <c>max(ts)</c> в <c>[WindowFrom, Before)</c> и <c>min(ts)</c> в <c>(After, WindowTo]</c>.
    /// </summary>
    Task<IReadOnlyList<TradeBracket>> QueryBracketsAsync(
        short sourceId,
        IReadOnlyList<TradeBracketRequest> requests,
        CancellationToken cancellationToken);
}
