namespace Scinverse.Ohs.Host;

/// <summary>
/// Дедуп мультиклиентских сигналов Host crash (crash-dispatch D1).
/// In-memory эпизод: merge по окну, <c>outageSeed = minFrom</c> Unix ms.
/// Emit T/C — шаги D2/D3.
/// </summary>
public sealed class HostOutageCoordinator
{
    /// <summary>Слияние POST, если |from − episode.minFrom| ≤ этого окна (спека §11 Q2).</summary>
    public static readonly TimeSpan DefaultMergeWindow = TimeSpan.FromSeconds(120);

    private readonly object _gate = new();
    private readonly TimeSpan _mergeWindow;
    private readonly TimeProvider _time;
    private HostOutageEpisode? _current;

    public HostOutageCoordinator(TimeSpan? mergeWindow = null, TimeProvider? time = null)
    {
        _mergeWindow = mergeWindow ?? DefaultMergeWindow;
        _time = time ?? TimeProvider.System;
    }

    /// <summary>Текущий эпизод (открытый или последний закрытый в окне) — для тестов / D2.</summary>
    public HostOutageEpisode? Current
    {
        get
        {
            lock (_gate)
            {
                return _current;
            }
        }
    }

    /// <summary>
    /// Принять сигнал от admin-клиента. Идемпотентно: повтор close / merge в окно.
    /// </summary>
    public HostOutageReportResult Report(string clientId, DateTimeOffset from, DateTimeOffset? to)
    {
        if (string.IsNullOrWhiteSpace(clientId))
        {
            throw new ArgumentException("clientId обязателен", nameof(clientId));
        }

        var now = _time.GetUtcNow();
        if (from > now)
        {
            from = now;
        }

        from = from.ToUniversalTime();
        if (to is { } rawTo)
        {
            var t = rawTo.ToUniversalTime();
            to = t < from ? from : t;
        }

        lock (_gate)
        {
            var episode = _current;
            var merge = episode is not null && WithinMergeWindow(from, episode.OpenedAt);

            if (!merge)
            {
                var seed = from.ToUnixTimeMilliseconds();
                episode = new HostOutageEpisode(seed, from);
                _current = episode;
                episode.AddClient(clientId);
                var closedEmitted = false;
                if (to is { } closeAt)
                {
                    episode.Close(closeAt);
                    closedEmitted = true;
                }

                return new HostOutageReportResult(
                    episode.OutageSeed,
                    episode.OpenedAt,
                    episode.ClosedAt,
                    IsNewEpisode: true,
                    OpenedEmitted: true,
                    ClosedEmitted: closedEmitted,
                    Merged: false);
            }

            episode!.AddClient(clientId);
            var openedBefore = episode.OpenedAt;
            episode.NoteEarlierFrom(from);
            if (episode.OpenedAt < openedBefore)
            {
                episode.RebindSeed(episode.OpenedAt.ToUnixTimeMilliseconds());
            }

            var closedEmittedMerge = false;
            if (to is { } close && episode.ClosedAt is null)
            {
                episode.Close(close);
                closedEmittedMerge = true;
            }

            return new HostOutageReportResult(
                episode.OutageSeed,
                episode.OpenedAt,
                episode.ClosedAt,
                IsNewEpisode: false,
                OpenedEmitted: false,
                ClosedEmitted: closedEmittedMerge,
                Merged: true);
        }
    }

    private bool WithinMergeWindow(DateTimeOffset from, DateTimeOffset episodeOpenedAt) =>
        (from - episodeOpenedAt).Duration() <= _mergeWindow;
}

/// <summary>Эпизод Host outage (один seed на пачку клиентов).</summary>
public sealed class HostOutageEpisode
{
    private readonly HashSet<string> _clientIds = new(StringComparer.Ordinal);

    public HostOutageEpisode(long outageSeed, DateTimeOffset openedAt)
    {
        OutageSeed = outageSeed;
        OpenedAt = openedAt.ToUniversalTime();
    }

    public long OutageSeed { get; private set; }
    public DateTimeOffset OpenedAt { get; private set; }
    public DateTimeOffset? ClosedAt { get; private set; }
    public IReadOnlyCollection<string> ClientIds => _clientIds;

    public string TransportCorrUid => $"ohs.host.transport:{OutageSeed}";

    public string ConnectionCorrUid(long connectionId) =>
        $"ohs.backend.outage:{OutageSeed}:c{connectionId}";

    public void AddClient(string clientId) => _clientIds.Add(clientId);

    public void NoteEarlierFrom(DateTimeOffset from)
    {
        var utc = from.ToUniversalTime();
        if (utc < OpenedAt)
        {
            OpenedAt = utc;
        }
    }

    public void RebindSeed(long seed) => OutageSeed = seed;

    public void Close(DateTimeOffset closedAt)
    {
        if (ClosedAt is not null)
        {
            return;
        }

        var utc = closedAt.ToUniversalTime();
        ClosedAt = utc < OpenedAt ? OpenedAt : utc;
    }
}

/// <summary>Результат <see cref="HostOutageCoordinator.Report"/> для D2/D3 emit.</summary>
public sealed record HostOutageReportResult(
    long OutageSeed,
    DateTimeOffset OpenedAt,
    DateTimeOffset? ClosedAt,
    bool IsNewEpisode,
    bool OpenedEmitted,
    bool ClosedEmitted,
    bool Merged);

/// <summary>Тело <c>POST /api/recovery/outage</c> (crash-dispatch D1).</summary>
public sealed record HostOutageReportRequest(
    string ClientId,
    DateTimeOffset From,
    DateTimeOffset? To = null);
