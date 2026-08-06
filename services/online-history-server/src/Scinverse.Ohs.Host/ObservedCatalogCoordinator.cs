using Scinverse.Ohs.Domain;
using Scinverse.Ohs.Ingestion;

namespace Scinverse.Ohs.Host;

/// <summary>Rebuild Observed snapshot + поднять узкий registry-кэш.</summary>
public sealed class ObservedCatalogCoordinator(
    IObservedInstrumentSet observed,
    IInstrumentRegistry registry,
    ILogger<ObservedCatalogCoordinator> logger)
{
    public async Task RebuildCacheAsync(CancellationToken cancellationToken)
    {
        await observed.RebuildAsync(cancellationToken).ConfigureAwait(false);
        await registry.ReloadObservedAsync(cancellationToken).ConfigureAwait(false);

        logger.LogInformation(
            "Observed cache rebuilt: {Count} instrument(s)",
            observed.SnapshotIds().Count);
    }
}
