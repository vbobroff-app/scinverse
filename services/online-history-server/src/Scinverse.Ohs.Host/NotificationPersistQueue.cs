using System.Threading.Channels;

namespace Scinverse.Ohs.Host;

/// <summary>
/// Разрыв между «горячим» хабом и медленной записью в БД (phase 11.2 persistence): хаб кладёт событие
/// без блокировки (<see cref="Enqueue"/>), фоновый <see cref="NotificationPersistWriter"/> дренит и
/// батч-инсертит. Канал ограничен и при переполнении роняет самые старые (аудит-лог, не критичный путь;
/// потеря под экстремальной нагрузкой предпочтительнее back-pressure на публикацию событий).
/// </summary>
public sealed class NotificationPersistQueue
{
    private readonly Channel<NotificationDto> _channel = Channel.CreateBounded<NotificationDto>(
        new BoundedChannelOptions(10_000)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
            SingleWriter = false,
        });

    public void Enqueue(NotificationDto evt) => _channel.Writer.TryWrite(evt);

    public ChannelReader<NotificationDto> Reader => _channel.Reader;
}
