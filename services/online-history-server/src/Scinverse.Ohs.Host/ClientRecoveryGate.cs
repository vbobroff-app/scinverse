namespace Scinverse.Ohs.Host;

/// <summary>
/// Барьер восстановления клиента на старте процесса (7j.20). Пока бэк лежал, клиент мог открыть инцидент
/// простоя (<c>backend.unavailable</c>, fatal). <see cref="ConnectionSupervisor"/> НЕ начинает первый
/// Auto-реконнект, пока инцидент не закрыт — чтобы «Система восстановлена» встала в NC ДО
/// <c>connection.connecting/connected</c> (порядок по времени честный: коннект к бирже реально после
/// закрытия простоя).
/// <para>
/// Отсчёт привязан к РЕАЛЬНОМУ подключению WS-клиента (<see cref="NotifyClientConnected"/> из
/// <see cref="WebSocketBroadcaster"/>), а не к старту процесса: WS становится доступен лишь через
/// несколько секунд после старта Kestrel, и таймер «от старта супервизора» проигрывал гонку реконнекту.
/// </para>
/// <para>Фазы одноразового <see cref="WaitAsync"/> (только на старте процесса):</para>
/// <list type="number">
///   <item><b>connect</b> — ждём, пока подключится хоть один WS-клиент. Никто не подключился за
///   connectGrace ⇒ наблюдателя нет ⇒ барьер спадает, Auto стартует.</item>
///   <item><b>heads-up</b> — клиент подключился: ждём <see cref="Hold"/> (heads-up «инцидент открыт»)
///   headsUpGrace. Нет heads-up ⇒ у клиента нет инцидента ⇒ Auto стартует.</item>
///   <item><b>hold</b> — после Hold ждём <see cref="Release"/> (<c>backend.recovered</c>) до holdGrace:
///   инцидент, затянутый нестабильностью (втянутые 500), удерживает Auto до реального закрытия.</item>
/// </list>
/// </summary>
public sealed class ClientRecoveryGate
{
    private readonly TaskCompletionSource _clientConnected = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly TaskCompletionSource _held = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly TaskCompletionSource _released = new(TaskCreationOptions.RunContinuationsAsynchronously);

    /// <summary>Подключился WS-клиент (из брокера). Запускает фазу heads-up. Идемпотентно.</summary>
    public void NotifyClientConnected() => _clientConnected.TrySetResult();

    /// <summary>Клиент заявил активный инцидент простоя (heads-up). Барьер ждёт recover. Идемпотентно.</summary>
    public void Hold() => _held.TrySetResult();

    /// <summary>Клиент подтвердил восстановление (<c>backend.recovered</c>) → снять барьер. Идемпотентно.</summary>
    public void Release() => _released.TrySetResult();

    /// <summary>
    /// Ждать снятия барьера. Возвращает причину снятия (для лога): <c>"recover"</c> — recover подтверждён
    /// (порядок соблюдён); <c>"no-client"</c> — никто не подключился; <c>"no-incident"</c> — клиент есть, но
    /// инцидента нет; <c>"hold-timeout"</c> — recover не пришёл за holdGrace.
    /// </summary>
    public async Task<string> WaitAsync(
        TimeSpan connectGrace,
        TimeSpan headsUpGrace,
        TimeSpan holdGrace,
        CancellationToken cancellationToken)
    {
        if (_released.Task.IsCompleted)
        {
            return "recover";
        }

        // Фаза connect: ждём подключения WS-клиента (или сразу hold/release, если уже пришли).
        var connectTimeout = Task.Delay(connectGrace, cancellationToken);
        var afterConnect = await Task
            .WhenAny(_released.Task, _held.Task, _clientConnected.Task, connectTimeout)
            .ConfigureAwait(false);
        if (afterConnect == _released.Task)
        {
            return "recover";
        }

        if (afterConnect == connectTimeout && !_clientConnected.Task.IsCompleted && !_held.Task.IsCompleted)
        {
            return "no-client";
        }

        // Фаза heads-up: клиент подключился — даём ему срок прислать hold.
        if (!_held.Task.IsCompleted)
        {
            var headsUpTimeout = Task.Delay(headsUpGrace, cancellationToken);
            var afterHeadsUp = await Task
                .WhenAny(_released.Task, _held.Task, headsUpTimeout)
                .ConfigureAwait(false);
            if (afterHeadsUp == _released.Task)
            {
                return "recover";
            }

            if (afterHeadsUp == headsUpTimeout && !_held.Task.IsCompleted)
            {
                return "no-incident";
            }
        }

        // Фаза hold: ждём recover до holdGrace.
        var holdTimeout = Task.Delay(holdGrace, cancellationToken);
        var afterHold = await Task.WhenAny(_released.Task, holdTimeout).ConfigureAwait(false);
        return afterHold == _released.Task ? "recover" : "hold-timeout";
    }
}
