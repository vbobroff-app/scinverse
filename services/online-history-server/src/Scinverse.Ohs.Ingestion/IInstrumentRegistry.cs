using System.Diagnostics.CodeAnalysis;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Ingestion;

/// <summary>Кэш-реестр инструментов: (ticker, board) → instrument_id и параметры цены.</summary>
public interface IInstrumentRegistry
{
    /// <summary>Загружает справочник из хранилища в кэш.</summary>
    Task InitializeAsync(CancellationToken cancellationToken);

    /// <summary>Идемпотентно регистрирует инструмент (upsert в хранилище) и кэширует его.</summary>
    Task<Instrument> RegisterAsync(SecurityInfo security, CancellationToken cancellationToken);

    bool TryResolve(InstrumentKey key, [MaybeNullWhen(false)] out Instrument instrument);
}
