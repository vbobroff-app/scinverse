namespace Scinverse.Ohs.Domain;

/// <summary>Справочник источников данных (data_source): резолв кода источника в source_id.</summary>
public interface ISourceStore
{
    /// <summary>Возвращает source_id по коду ('transaq'/'synthetic'/'qscalp').</summary>
    Task<short> ResolveIdAsync(string code, CancellationToken cancellationToken);

    /// <summary>Все источники данных.</summary>
    Task<IReadOnlyList<DataSource>> ListAsync(CancellationToken cancellationToken);
}

/// <summary>Источник данных (data_source).</summary>
public sealed record DataSource(short SourceId, string Code, string? Name);
