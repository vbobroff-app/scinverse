namespace Scinverse.Ohs.Domain.Schedule;

/// <summary>Реестр подтверждателей: выбор адаптера по коду (external_service.adapter).</summary>
public interface IScheduleConfirmerRegistry
{
    /// <summary>Подтверждатель по коду адаптера или null, если такого нет.</summary>
    IScheduleConfirmer? ForAdapter(string adapter);
}
