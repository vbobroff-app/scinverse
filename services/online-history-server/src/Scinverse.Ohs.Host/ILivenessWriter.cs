namespace Scinverse.Ohs.Host;

/// <summary>
/// Обратные вызовы живости захвата (phase 7h.2): хартбит по данным/тику, закрытие при стопе/дисконнекте.
/// Реализация — <see cref="LivenessProbe"/>.
/// </summary>
public interface ILivenessWriter
{
    /// <summary>Данные от коннектора (сделка/свежий поток) — бесплатный хартбит без пинга.</summary>
    Task OnDataAsync(long connectionId, CancellationToken cancellationToken);

    /// <summary>Последняя запись на подключении остановлена — закрыть интервал живости, если больше нет записей.</summary>
    Task OnRecordingStoppedAsync(long connectionId, CancellationToken cancellationToken);

    /// <summary>Подключение разорвано — закрыть открытый интервал живости.</summary>
    Task OnDisconnectedAsync(long connectionId, CancellationToken cancellationToken);

    /// <summary><c>server_status</c> down/error — закрыть живость (причина server_down).</summary>
    Task OnServerDownAsync(long connectionId, DateTimeOffset at, CancellationToken cancellationToken);
}
