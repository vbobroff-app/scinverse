using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Суточная свежесть OPT-окна (per connection + futures + expiration), ортогонально dump-Invalidate.
/// </summary>
public sealed class OptionWindowFreshness(TimeProvider time)
{
    private readonly object _gate = new();
    private readonly Dictionary<(long ConnectionId, long FuturesId, DateOnly Expiration), DateOnly> _loaded = new();

    public bool IsFresh(long connectionId, long futuresId, DateOnly expiration)
    {
        var today = InstrumentLifecycle.TodayMoscow(time);
        lock (_gate)
        {
            return _loaded.TryGetValue((connectionId, futuresId, expiration), out var day) && day == today;
        }
    }

    public void MarkFresh(long connectionId, long futuresId, DateOnly expiration)
    {
        var today = InstrumentLifecycle.TodayMoscow(time);
        lock (_gate)
        {
            _loaded[(connectionId, futuresId, expiration)] = today;
        }
    }

    public void InvalidateAll()
    {
        lock (_gate)
        {
            _loaded.Clear();
        }
    }
}
