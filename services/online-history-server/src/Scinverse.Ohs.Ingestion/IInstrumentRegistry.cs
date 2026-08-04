using System.Diagnostics.CodeAnalysis;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Ingestion;

/// <summary>Кэш-реестр инструментов: (ticker, board) → instrument_id и параметры цены.</summary>
public interface IInstrumentRegistry
{
    /// <summary>Загружает справочник из хранилища в кэш; помечает каталог свежим.</summary>
    Task InitializeAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Наблюдение справочника из pump (неблокирующее для hit). Cache-hit при свежем каталоге —
    /// no-op; при invalidate — фоновый persist; miss — батч-запись (синхронный flush по порогу).
    /// </summary>
    void Observe(SecurityInfo security);

    /// <summary>Сбрасывает накопленные miss в БД (вызывать перед обработкой сделок в pump).</summary>
    Task FlushPendingAsync(CancellationToken cancellationToken);

    /// <summary>Если miss-буфер ≥ порога — сбросить батч в БД (из pump после Observe).</summary>
    Task TryFlushMissThresholdAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Полная регистрация (maintenance/reenrich): Observe + FlushPending + возврат из кэша.
    /// </summary>
    Task<Instrument> RegisterAsync(SecurityInfo security, CancellationToken cancellationToken);

    /// <summary>
    /// Инвалидация каталога (разрешить persist hit-ов). <paramref name="force"/> — кнопка Refresh
    /// (игнор суточного гейта); иначе — не чаще раза в торговый день (МСК), типично Auto-on.
    /// </summary>
    bool Invalidate(bool force = false);

    /// <summary>Каталог свеж: hit → без записи в БД.</summary>
    bool IsFresh { get; }

    /// <summary>Помечает каталог свежим (после idle фонового persist).</summary>
    void MarkFresh();

    bool TryResolve(InstrumentKey key, [MaybeNullWhen(false)] out Instrument instrument);

    /// <summary>Обратный поиск по стабильному id (для команд управления записью).</summary>
    bool TryResolveById(long instrumentId, [MaybeNullWhen(false)] out Instrument instrument);

    /// <summary>Убрать инструменты из online-кэша (после lifecycle archive).</summary>
    void Evict(IEnumerable<long> instrumentIds);

    /// <summary>
    /// После фонового upsert: в кэш только <c>Active</c>; архив вытесняется.
    /// </summary>
    void ApplyPersisted(IEnumerable<Instrument> instruments);
}
