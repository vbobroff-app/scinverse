namespace Scinverse.Ohs.Host;

/// <summary>
/// I2: единый эмиттер шага эпизода → <c>incident</c> + Hub/NC из одного <see cref="IncidentStep"/>.
/// </summary>
public interface IIncidentFanOut
{
    /// <summary>
    /// Применить шаг: NC (если задан <see cref="IncidentStep.NcCode"/>) и журнал.
    /// Возвращает <c>corr_uid</c> (после Open — из Hub; иначе из шага / open subject).
    /// </summary>
    Task<string?> ApplyAsync(IncidentStep step, CancellationToken cancellationToken = default);
}
