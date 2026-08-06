using System.Collections.Concurrent;
using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Storage.Timescale;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Observed = union ☑ static members ∪ (recording on ∨ Auto) по connections.
/// System <c>recording</c> enabled=false → live recording не подмешиваем.
/// </summary>
public sealed class ObservedInstrumentSet(
    IBasketStore baskets,
    IRecordingScheduleStore schedule,
    IConnectionStore connections,
    Lazy<RecordingManager> recordings) : IObservedInstrumentSet
{
    private readonly ConcurrentDictionary<long, byte> _ids = new();

    public bool RestrictsCache => true;

    public bool IsObserved(long instrumentId) => _ids.ContainsKey(instrumentId);

    public IReadOnlyList<long> SnapshotIds() => _ids.Keys.OrderBy(id => id).ToList();

    public async Task<IReadOnlyList<long>> ListForConnectionAsync(
        long connectionId, CancellationToken cancellationToken)
    {
        var set = new HashSet<long>();
        await AddConnectionAsync(connectionId, set, cancellationToken).ConfigureAwait(false);
        return set.OrderBy(id => id).ToList();
    }

    public async Task RebuildAsync(CancellationToken cancellationToken)
    {
        var next = new HashSet<long>();
        var conns = await connections.ListAsync(cancellationToken).ConfigureAwait(false);
        foreach (var conn in conns)
        {
            await AddConnectionAsync(conn.ConnectionId, next, cancellationToken).ConfigureAwait(false);
        }

        _ids.Clear();
        foreach (var id in next)
        {
            _ids[id] = 0;
        }
    }

    private async Task AddConnectionAsync(
        long connectionId, HashSet<long> into, CancellationToken cancellationToken)
    {
        await baskets.EnsureSystemBasketsAsync(connectionId, cancellationToken).ConfigureAwait(false);
        var list = await baskets.ListAsync(connectionId, cancellationToken).ConfigureAwait(false);

        foreach (var basket in list.Where(b => b.Enabled && b.Kind == BasketKind.Static))
        {
            var members = await baskets.ListMemberIdsAsync(basket.BasketId, cancellationToken)
                .ConfigureAwait(false);
            foreach (var id in members)
            {
                into.Add(id);
            }
        }

        var recordingBasket = list.FirstOrDefault(b =>
            b.Kind == BasketKind.System
            && string.Equals(b.SystemId, BasketStore.SystemRecording, StringComparison.Ordinal));

        if (recordingBasket is { Enabled: true })
        {
            var auto = await schedule.ListEnabledAsync(cancellationToken).ConfigureAwait(false);
            foreach (var entry in auto.Where(e => e.ConnectionId == connectionId))
            {
                into.Add(entry.InstrumentId);
            }

            foreach (var rec in recordings.Value.List().Where(r => r.ConnectionId == connectionId))
            {
                into.Add(rec.InstrumentId);
            }
        }
    }
}
