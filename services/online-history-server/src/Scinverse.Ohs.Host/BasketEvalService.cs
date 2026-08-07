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
        // Glob по short_name (обозначение MOEX Si-9.26); ticker/seccode — только fallback.
        var globMatch = TickerGlob.Compile(rule.Patterns);

        return available
            .Where(a =>
                globMatch(MatchText(a))
                && (secType is null
                    || string.Equals(a.SecType, secType, StringComparison.OrdinalIgnoreCase))
                && (board is null
                    || string.Equals(a.Board, board, StringComparison.OrdinalIgnoreCase)))
            .OrderBy(a => a.ShortName ?? a.Ticker, StringComparer.OrdinalIgnoreCase)
            .ThenBy(a => a.Board, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <summary>Primary: short_name; если пуст — ticker (акции без обозначения FORTS).</summary>
    private static string MatchText(AvailableInstrument a) =>
        string.IsNullOrWhiteSpace(a.ShortName) ? a.Ticker : a.ShortName;

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

    /// <summary>Re-eval всех static baskets connection; возвращает дельту members.</summary>
    public async Task<BasketEvalDelta> ReEvalConnectionAsync(
        long connectionId, CancellationToken cancellationToken)
    {
        await baskets.EnsureSystemBasketsAsync(connectionId, cancellationToken).ConfigureAwait(false);
        var list = await baskets.ListAsync(connectionId, cancellationToken).ConfigureAwait(false);
        var available = await instruments.ListAvailableAsync(cancellationToken).ConfigureAwait(false);
        var availableById = available.ToDictionary(a => a.InstrumentId);

        var staticBaskets = list.Where(b => b.Kind == BasketKind.Static && b.Rule is not null).ToList();
        var added = new List<BasketMemberChange>();
        var removedIds = new List<(long BasketId, string BasketName, long InstrumentId)>();

        foreach (var basket in staticBaskets)
        {
            var before = await baskets.ListMemberIdsAsync(basket.BasketId, cancellationToken)
                .ConfigureAwait(false);
            var beforeSet = before.ToHashSet();

            var matched = Match(basket.Rule!, available);
            var afterIds = matched.Select(m => m.InstrumentId).ToList();
            var afterSet = afterIds.ToHashSet();

            await baskets.ReplaceMembersAsync(basket.BasketId, afterIds, cancellationToken)
                .ConfigureAwait(false);

            foreach (var id in afterSet.Except(beforeSet))
            {
                var label = availableById.TryGetValue(id, out var a)
                    ? MatchText(a)
                    : $"#{id}";
                added.Add(new BasketMemberChange(basket.BasketId, basket.Name, id, label));
            }

            foreach (var id in beforeSet.Except(afterSet))
            {
                removedIds.Add((basket.BasketId, basket.Name, id));
            }
        }

        var labels = await instruments
            .GetDisplayLabelsAsync(removedIds.Select(r => r.InstrumentId).Distinct().ToList(), cancellationToken)
            .ConfigureAwait(false);

        var removed = removedIds
            .Select(r => new BasketMemberChange(
                r.BasketId,
                r.BasketName,
                r.InstrumentId,
                labels.TryGetValue(r.InstrumentId, out var lab) ? lab : $"#{r.InstrumentId}"))
            .ToList();

        if (staticBaskets.Count > 0)
        {
            logger.LogInformation(
                "Basket re-eval: connection {ConnectionId}, {BasketCount} static, available={Available}, +{Added}/-{Removed}",
                connectionId, staticBaskets.Count, available.Count, added.Count, removed.Count);
        }

        return new BasketEvalDelta(added, removed);
    }

    /// <summary>Re-eval static по всем connections (суточный Lifecycle / force Refresh).</summary>
    public async Task<BasketEvalDelta> ReEvalAllConnectionsAsync(CancellationToken cancellationToken)
    {
        var conns = await connections.ListAsync(cancellationToken).ConfigureAwait(false);
        var delta = BasketEvalDelta.Empty;
        foreach (var conn in conns)
        {
            var part = await ReEvalConnectionAsync(conn.ConnectionId, cancellationToken).ConfigureAwait(false);
            delta = delta.Merge(part);
        }

        return delta;
    }
}
