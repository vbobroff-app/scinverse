using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Eval static baskets: Available ∩ rules → preview / materialize <c>basket_member</c>.
/// Re-eval на Lifecycle/Refresh и после OK модалки (C1).
/// </summary>
public sealed class BasketEvalService(
    IInstrumentStore instruments,
    IBasketStore baskets,
    IConnectionStore connections,
    ILogger<BasketEvalService> logger)
{
    /// <summary>Синхронный матч правила по уже загруженному Available.</summary>
    public IReadOnlyList<AvailableInstrument> Match(
        BasketRule rule, IReadOnlyList<AvailableInstrument> available)
    {
        ArgumentNullException.ThrowIfNull(rule);
        ArgumentNullException.ThrowIfNull(available);

        if (rule.Patterns.Count == 0)
        {
            return [];
        }

        var secType = string.IsNullOrWhiteSpace(rule.SecType) ? null : rule.SecType.Trim();
        var board = string.IsNullOrWhiteSpace(rule.BoardId) ? null : rule.BoardId.Trim();

        return available
            .Where(a =>
                TickerGlob.IsMatch(a.Ticker, rule.Patterns)
                && (secType is null
                    || string.Equals(a.SecType, secType, StringComparison.OrdinalIgnoreCase))
                && (board is null
                    || string.Equals(a.Board, board, StringComparison.OrdinalIgnoreCase)))
            .OrderBy(a => a.Ticker, StringComparer.OrdinalIgnoreCase)
            .ThenBy(a => a.Board, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public async Task<IReadOnlyList<AvailableInstrument>> PreviewAsync(
        BasketRule rule, CancellationToken cancellationToken)
    {
        var available = await instruments.ListAvailableAsync(cancellationToken).ConfigureAwait(false);
        return Match(rule, available);
    }

    /// <summary>Eval правил basket → заменить <c>basket_member</c>. Только static.</summary>
    public async Task<int> MaterializeAsync(long basketId, CancellationToken cancellationToken)
    {
        var basket = await baskets.GetAsync(basketId, cancellationToken).ConfigureAwait(false)
            ?? throw new InvalidOperationException($"Basket {basketId} not found.");

        if (basket.Kind != BasketKind.Static)
        {
            throw new InvalidOperationException($"Basket {basketId} is '{basket.Kind}', expected static.");
        }

        if (basket.Rule is null)
        {
            throw new InvalidOperationException($"Basket {basketId} has no rules.");
        }

        var matched = await PreviewAsync(basket.Rule, cancellationToken).ConfigureAwait(false);
        var ids = matched.Select(m => m.InstrumentId).ToList();
        await baskets.ReplaceMembersAsync(basketId, ids, cancellationToken).ConfigureAwait(false);

        logger.LogInformation(
            "Basket eval: basket {BasketId} ({Name}) → {Count} member(s)",
            basketId, basket.Name, ids.Count);
        return ids.Count;
    }

    /// <summary>Re-eval всех static baskets connection (после archive / Refresh / OK).</summary>
    public async Task ReEvalConnectionAsync(long connectionId, CancellationToken cancellationToken)
    {
        await baskets.EnsureSystemBasketsAsync(connectionId, cancellationToken).ConfigureAwait(false);
        var list = await baskets.ListAsync(connectionId, cancellationToken).ConfigureAwait(false);
        var available = await instruments.ListAvailableAsync(cancellationToken).ConfigureAwait(false);

        var staticBaskets = list.Where(b => b.Kind == BasketKind.Static && b.Rule is not null).ToList();
        foreach (var basket in staticBaskets)
        {
            var matched = Match(basket.Rule!, available);
            var ids = matched.Select(m => m.InstrumentId).ToList();
            await baskets.ReplaceMembersAsync(basket.BasketId, ids, cancellationToken).ConfigureAwait(false);
        }

        if (staticBaskets.Count > 0)
        {
            logger.LogInformation(
                "Basket re-eval: connection {ConnectionId}, {BasketCount} static basket(s), available={Available}",
                connectionId, staticBaskets.Count, available.Count);
        }
    }

    /// <summary>Re-eval static по всем connections (суточный Lifecycle / force Refresh).</summary>
    public async Task ReEvalAllConnectionsAsync(CancellationToken cancellationToken)
    {
        var conns = await connections.ListAsync(cancellationToken).ConfigureAwait(false);
        foreach (var conn in conns)
        {
            await ReEvalConnectionAsync(conn.ConnectionId, cancellationToken).ConfigureAwait(false);
        }
    }
}
