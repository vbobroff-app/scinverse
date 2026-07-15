using Scinverse.Ohs.Domain.Schedule;

namespace Scinverse.Ohs.Host;

/// <summary>Реестр подтверждателей: выбор адаптера по коду (external_service.adapter), регистронезависимо.</summary>
public sealed class ScheduleConfirmerRegistry : IScheduleConfirmerRegistry
{
    private readonly Dictionary<string, IScheduleConfirmer> _byAdapter;

    public ScheduleConfirmerRegistry(IEnumerable<IScheduleConfirmer> confirmers) =>
        _byAdapter = confirmers.ToDictionary(c => c.Adapter, StringComparer.OrdinalIgnoreCase);

    public IScheduleConfirmer? ForAdapter(string adapter) =>
        !string.IsNullOrWhiteSpace(adapter) && _byAdapter.TryGetValue(adapter, out var confirmer)
            ? confirmer
            : null;
}
