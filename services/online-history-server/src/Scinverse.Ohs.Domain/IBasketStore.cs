namespace Scinverse.Ohs.Domain;

/// <summary>Хранилище наборов Observed (instrument_basket / basket_rule / basket_member).</summary>
public interface IBasketStore
{
    /// <summary>
    /// Идемпотентно создаёт system-строки connection: <c>recording</c> (enabled),
    /// <c>has_data</c> (disabled «скоро»).
    /// </summary>
    Task EnsureSystemBasketsAsync(long connectionId, CancellationToken cancellationToken);

    Task<IReadOnlyList<InstrumentBasket>> ListAsync(long connectionId, CancellationToken cancellationToken);

    Task<InstrumentBasket?> GetAsync(long basketId, CancellationToken cancellationToken);

    Task<InstrumentBasket> CreateStaticAsync(
        long connectionId,
        string name,
        BasketRule rule,
        bool enabled,
        CancellationToken cancellationToken);

    Task<InstrumentBasket> UpdateStaticAsync(
        long basketId,
        string name,
        BasketRule rule,
        CancellationToken cancellationToken);

    Task<InstrumentBasket> SetEnabledAsync(long basketId, bool enabled, CancellationToken cancellationToken);

    /// <summary>Удаляет non-system basket (CASCADE rule/members).</summary>
    Task DeleteAsync(long basketId, CancellationToken cancellationToken);

    Task ReplaceMembersAsync(
        long basketId,
        IReadOnlyList<long> instrumentIds,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<long>> ListMemberIdsAsync(long basketId, CancellationToken cancellationToken);

    /// <summary>
    /// Union instrument_id из <b>enabled static</b> baskets connection.
    /// Live system (<c>recording</c>) Host подмешивает отдельно.
    /// </summary>
    Task<IReadOnlyList<long>> ListEnabledStaticMemberIdsAsync(
        long connectionId,
        CancellationToken cancellationToken);
}
