using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.UnitTests;

/// <summary>Пустые зависимости для конструктора <see cref="Host.BasketEvalService"/> в тестах.</summary>
internal sealed class EmptyBasketStore : IBasketStore
{
    public Task EnsureSystemBasketsAsync(long connectionId, CancellationToken cancellationToken) =>
        Task.CompletedTask;

    public Task<IReadOnlyList<InstrumentBasket>> ListAsync(
        long connectionId, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<InstrumentBasket>>([]);

    public Task<InstrumentBasket?> GetAsync(long basketId, CancellationToken cancellationToken) =>
        Task.FromResult<InstrumentBasket?>(null);

    public Task<InstrumentBasket> CreateStaticAsync(
        long connectionId, string name, BasketRule rule, bool enabled, CancellationToken cancellationToken) =>
        throw new NotSupportedException();

    public Task<InstrumentBasket> UpdateStaticAsync(
        long basketId, string name, BasketRule rule, CancellationToken cancellationToken) =>
        throw new NotSupportedException();

    public Task<InstrumentBasket> SetEnabledAsync(
        long basketId, bool enabled, CancellationToken cancellationToken) =>
        throw new NotSupportedException();

    public Task DeleteAsync(long basketId, CancellationToken cancellationToken) =>
        throw new NotSupportedException();

    public Task ReplaceMembersAsync(
        long basketId, IReadOnlyList<long> instrumentIds, CancellationToken cancellationToken) =>
        Task.CompletedTask;

    public Task<IReadOnlyList<long>> ListMemberIdsAsync(
        long basketId, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<long>>([]);

    public Task<IReadOnlyList<long>> ListEnabledStaticMemberIdsAsync(
        long connectionId, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<long>>([]);
}

internal sealed class EmptyConnectionStoreForLifecycle : IConnectionStore
{
    public Task<IReadOnlyList<ConnectorConnection>> ListAsync(CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<ConnectorConnection>>([]);

    public Task<ConnectorConnection?> GetAsync(long connectionId, CancellationToken cancellationToken) =>
        Task.FromResult<ConnectorConnection?>(null);

    public Task<ConnectorConnection> UpsertAsync(
        short sourceId, string name, string kind, string settings, bool enabled,
        CancellationToken cancellationToken) =>
        throw new NotSupportedException();

    public Task<ConnectorConnection?> UpdateAsync(
        long connectionId, short sourceId, string name, string kind, string settings, bool enabled,
        CancellationToken cancellationToken) =>
        throw new NotSupportedException();

    public Task<bool> DeleteAsync(long connectionId, CancellationToken cancellationToken) =>
        Task.FromResult(false);

    public Task SetEnabledAsync(long connectionId, bool enabled, CancellationToken cancellationToken) =>
        Task.CompletedTask;
}
