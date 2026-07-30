using System.Collections.Concurrent;
using System.Text.Json;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.Host;

/// <summary>
/// In-memory ring-buffer уведомлений + broadcast WS <c>notification</c> (phase 7j / тонкий 11.2) +
/// сдача события в долговременный аудит-лог (<see cref="NotificationPersistQueue"/> → фоновый writer).
/// Плюс оркестратор жизненного цикла (ось B): <see cref="Open"/>/<see cref="Progress"/>/<see cref="Resolve"/>
/// по <c>subject</c>. Единственный источник правды переходов — этот хаб (фронт = проекция upsert).
/// Каждый новый инцидент получает свой <c>correlationId = subject:uid</c> (per-occurrence scope):
/// один и тот же subject, открытый повторно после resolved, получает новый uid — история инцидентов
/// не смешивается, а поиск по префиксу subject собирает их все. Переходы и запись в буфер атомарны
/// под <c>_gate</c> (pessimistic lock), broadcast и persist — вне лока.
/// </summary>
public sealed class NotificationHub(WebSocketBroadcaster broadcaster, NotificationPersistQueue? persist = null)
    : INotificationPublisher
{
    public const int DefaultCapacity = 500;

    /// <summary>Заглушка единственного встроенного оператора до Keycloak (phase 10). Единая точка:
    /// user-события без явного актора атрибутируются сюда; после auth заменится на реальный <c>sub</c>,
    /// <c>'superuser'</c> останется валидным историческим actor_id в старых строках лога.</summary>
    public static readonly NotificationActor Superuser = new("user", "superuser", "Оператор");

    private readonly ConcurrentQueue<NotificationDto> _buffer = new();
    private int _count;
    private readonly object _gate = new();

    /// <summary>Открытые инциденты: subject → (correlationId текущего инцидента, статус active|underway). resolved снимается.</summary>
    private readonly Dictionary<string, (string CorrelationId, string Status)> _openIncidents = new();

    public void Publish(
        string code,
        string message,
        string severity = "info",
        string sourceType = "system",
        string module = "ohs.connection",
        object? data = null,
        string? status = null,
        string? correlationId = null,
        NotificationActor? actor = null,
        string? subject = null,
        DateTimeOffset? ts = null)
    {
        // Одиночное событие; status/correlationId — для продюсер-управляемых последовательностей
        // (напр. фаза connect: connecting→connect/failed одной группой), минуя incident-оркестратор.
        var evt = Enqueue(code, message, severity, sourceType, module, status, correlationId, data, actor, subject, ts);
        Dispatch(evt);
    }

    /// <summary>Приём внешне-авторского уведомления (7j.20 — mock будущего внешнего NC). Клиент шлёт уже
    /// сформированное событие с СОБСТВЕННЫМ <paramref name="id"/> и, возможно, ПРОШЛЫМ <paramref name="ts"/>
    /// (backdated: событие произошло раньше доставки — напр. недоступность бэка детектит клиент, а POST
    /// уходит только по реконнекту). Пишем в буфер/аудит-лог и broadcast'им ВЕРБАТИМ (id/ts клиента);
    /// дедуп по id — на приёмнике (шина фронта). Это mock: позже тот же контракт уйдёт во внешний сервис.</summary>
    public void Ingest(
        string id,
        DateTimeOffset ts,
        string code,
        string message,
        string severity = "info",
        string sourceType = "system",
        string module = "ohs.connection",
        JsonElement? data = null,
        string? status = null,
        string? correlationId = null)
    {
        NotificationDto evt;
        lock (_gate)
        {
            var resolvedActor = ResolveActor(null, sourceType, module);
            evt = new NotificationDto(
                Id: id,
                Ts: ts,
                Severity: severity,
                SourceType: sourceType,
                Module: module,
                Code: code,
                Message: message,
                Status: status,
                CorrelationId: correlationId,
                Data: NotificationThreadData.EnrichJson(code, status, data),
                Interaction: ResolveInteraction(sourceType),
                Localization: ResolveLocalization(sourceType),
                ActorKind: resolvedActor.Kind,
                ActorId: resolvedActor.Id,
                ActorLabel: resolvedActor.Label,
                Subject: null);

            _buffer.Enqueue(evt);
            _count++;
            while (_count > DefaultCapacity && _buffer.TryDequeue(out _))
            {
                _count--;
            }
        }

        Dispatch(evt);
    }

    /// <summary>Открыть инцидент (status=active). Только если по subject ещё нет open (active/underway).
    /// Повторный open / эскалация внутри нити — <see cref="Append"/> (иначе underway→Open схлопывал
    /// первый <c>connection.lost</c> Degraded на шине).</summary>
    public bool Open(
        string subject,
        string code,
        string message,
        string severity = "warning",
        string sourceType = "system",
        string module = "ohs.connection",
        object? data = null,
        NotificationActor? actor = null,
        DateTimeOffset? ts = null)
        => Transition(subject, "active", code, message, severity, sourceType, module, data, actor, ts,
            canTransition: current => current is null);

    /// <summary>Прогресс восстановления (status=underway) открытого инцидента. Повторяемо (7j.20 J5):
    /// active→underway и underway→underway — каждый прогресс-тик (elapsed / попытка k/N) пишет строку под
    /// тем же correlationId; фронт схлопывает нить по correlationId (показывает последнюю). Не открывает и
    /// не закрывает инцидент: без открытого (active/underway) — no-op.</summary>
    public bool Progress(
        string subject,
        string code,
        string message,
        string severity = "info",
        string sourceType = "system",
        string module = "ohs.connection",
        object? data = null,
        NotificationActor? actor = null,
        DateTimeOffset? ts = null)
        => Transition(subject, "underway", code, message, severity, sourceType, module, data, actor, ts,
            canTransition: current => current is "active" or "underway");

    /// <inheritdoc />
    public bool Append(
        string subject,
        string code,
        string message,
        string severity = "error",
        string sourceType = "system",
        string module = "ohs.connection",
        object? data = null,
        NotificationActor? actor = null,
        string? status = null,
        DateTimeOffset? ts = null)
    {
        NotificationDto? evt;
        lock (_gate)
        {
            if (!_openIncidents.TryGetValue(subject, out var open))
            {
                return false;
            }

            var stamp = open.Status;
            if (status is "active" or "underway")
            {
                stamp = status;
                _openIncidents[subject] = (open.CorrelationId, stamp);
            }

            evt = EnqueueLocked(
                code, message, severity, sourceType, module,
                stamp, open.CorrelationId, data, actor, subject, ts);
        }

        Dispatch(evt);
        return true;
    }

    /// <summary>Закрыть инцидент (status=resolved, терминальный). Идемпотентно: повторный resolve — no-op.</summary>
    public bool Resolve(
        string subject,
        string code,
        string message,
        string severity = "ok",
        string sourceType = "system",
        string module = "ohs.connection",
        object? data = null,
        NotificationActor? actor = null,
        DateTimeOffset? ts = null)
        => Transition(subject, "resolved", code, message, severity, sourceType, module, data, actor, ts,
            canTransition: current => current is "active" or "underway");

    /// <inheritdoc />
    public bool Adopt(string subject, string correlationId, string status)
    {
        if (string.IsNullOrWhiteSpace(subject)
            || string.IsNullOrWhiteSpace(correlationId)
            || status is not ("active" or "underway"))
        {
            return false;
        }

        lock (_gate)
        {
            if (_openIncidents.TryGetValue(subject, out var existing))
            {
                // Тот же corr уже в памяти — идемпотентный успех; чужой corr не перетираем.
                return existing.CorrelationId == correlationId;
            }

            _openIncidents[subject] = (correlationId, status);
            return true;
        }
    }

    /// <inheritdoc />
    public bool Forget(string subject, string? correlationId = null)
    {
        if (string.IsNullOrWhiteSpace(subject))
        {
            return false;
        }

        lock (_gate)
        {
            if (!_openIncidents.TryGetValue(subject, out var open))
            {
                return false;
            }

            if (correlationId is not null
                && !string.Equals(open.CorrelationId, correlationId, StringComparison.Ordinal))
            {
                return false;
            }

            return _openIncidents.Remove(subject);
        }
    }

    /// <inheritdoc />
    public bool TryGetOpenCorrelationId(string subject, out string? correlationId)
    {
        correlationId = null;
        if (string.IsNullOrWhiteSpace(subject))
        {
            return false;
        }

        lock (_gate)
        {
            if (!_openIncidents.TryGetValue(subject, out var open))
            {
                return false;
            }

            correlationId = open.CorrelationId;
            return true;
        }
    }

    private bool Transition(
        string subject,
        string targetStatus,
        string code,
        string message,
        string severity,
        string sourceType,
        string module,
        object? data,
        NotificationActor? actor,
        DateTimeOffset? ts,
        Func<string?, bool> canTransition)
    {
        NotificationDto? evt;
        lock (_gate)
        {
            var open = _openIncidents.TryGetValue(subject, out var s) ? s : ((string CorrelationId, string Status)?)null;
            if (!canTransition(open?.Status))
            {
                return false; // I2: нет смены статуса — не плодим строку.
            }

            // Открытый инцидент переиспользует свой correlationId; новый (Open по пустому subject) получает subject:uid.
            var correlationId = open?.CorrelationId ?? $"{subject}:{Guid.NewGuid().ToString("N")[..8]}";

            if (targetStatus == "resolved")
            {
                _openIncidents.Remove(subject);
            }
            else
            {
                _openIncidents[subject] = (correlationId, targetStatus);
            }

            evt = EnqueueLocked(
                code, message, severity, sourceType, module, targetStatus, correlationId, data, actor, subject, ts);
        }

        Dispatch(evt);
        return true;
    }

    private NotificationDto Enqueue(
        string code, string message, string severity, string sourceType, string module,
        string? status, string? correlationId, object? data, NotificationActor? actor, string? subject,
        DateTimeOffset? ts)
    {
        lock (_gate)
        {
            return EnqueueLocked(
                code, message, severity, sourceType, module, status, correlationId, data, actor, subject, ts);
        }
    }

    private NotificationDto EnqueueLocked(
        string code, string message, string severity, string sourceType, string module,
        string? status, string? correlationId, object? data, NotificationActor? actor, string? subject,
        DateTimeOffset? ts)
    {
        var resolvedActor = ResolveActor(actor, sourceType, module);
        // 11.11: threadKindHint / closeOutcome в data jsonb (без смены схемы).
        var enriched = NotificationThreadData.EnrichByCode(code, status, data);
        var evt = new NotificationDto(
            Id: Guid.NewGuid().ToString("N"),
            Ts: ts ?? DateTimeOffset.UtcNow,
            Severity: severity,
            SourceType: sourceType,
            Module: module,
            Code: code,
            Message: message,
            Status: status,
            CorrelationId: correlationId,
            Data: enriched is null ? null : JsonSerializer.SerializeToElement(enriched),
            Interaction: ResolveInteraction(sourceType),
            Localization: ResolveLocalization(sourceType),
            ActorKind: resolvedActor.Kind,
            ActorId: resolvedActor.Id,
            ActorLabel: resolvedActor.Label,
            Subject: subject);

        _buffer.Enqueue(evt);
        _count++;
        while (_count > DefaultCapacity && _buffer.TryDequeue(out _))
        {
            _count--;
        }

        return evt;
    }

    /// <summary>Broadcast в WS + сдача в аудит-лог. Вне <c>_gate</c> (persist/broadcast не под локом).</summary>
    private void Dispatch(NotificationDto evt)
    {
        persist?.Enqueue(evt);
        broadcaster.Broadcast(new NotificationLiveEvent(evt));
    }

    /// <summary>Прогреть ring-buffer из БД на старте (последние N, oldest-first). Без broadcast/persist:
    /// клиенты берут бэклог через <c>GET /api/notifications</c>, а строки уже в логе.</summary>
    public void Hydrate(IReadOnlyList<NotificationDto> events)
    {
        lock (_gate)
        {
            foreach (var evt in events)
            {
                _buffer.Enqueue(evt);
                _count++;
            }

            while (_count > DefaultCapacity && _buffer.TryDequeue(out _))
            {
                _count--;
            }
        }
    }

    public IReadOnlyList<NotificationDto> List(int? limit = null)
    {
        var all = _buffer.ToArray();
        if (limit is null || limit.Value >= all.Length)
        {
            return all;
        }

        return all.TakeLast(limit.Value).ToArray();
    }

    private static string ResolveInteraction(string sourceType) => sourceType == "user" ? "user" : "system";

    private static string ResolveLocalization(string sourceType) => sourceType == "external" ? "external" : "internal";

    private static NotificationActor ResolveActor(NotificationActor? actor, string sourceType, string module)
        => actor ?? sourceType switch
        {
            "user" => Superuser,
            "external" => new NotificationActor("external", module, module),
            _ => new NotificationActor("system", module, module),
        };
}

public sealed record NotificationDto(
    string Id,
    DateTimeOffset Ts,
    string Severity,
    string SourceType,
    string Module,
    string Code,
    string Message,
    string? Status,
    string? CorrelationId,
    JsonElement? Data,
    string Interaction,
    string Localization,
    string ActorKind,
    string ActorId,
    string ActorLabel,
    string? Subject);

public sealed record NotificationLiveEvent(NotificationDto Notification) : LiveEvent("notification");

/// <summary>Тело mock-POST внешне-авторского уведомления (<c>POST /api/notifications</c>, 7j.20).
/// <c>Ts</c> может быть в прошлом (backdated). <c>Id</c> — клиентский (дедуп по нему на шине).</summary>
public sealed record IngestNotificationRequest(
    string Id,
    DateTimeOffset Ts,
    string Code,
    string Message,
    string? Severity,
    string? SourceType,
    string? Module,
    JsonElement? Data,
    string? Status,
    string? CorrelationId);

/// <summary>Тело <c>POST /api/recovery/hold</c> (7j.20 §9.2): corr открытого клиентского инцидента простоя,
/// чтобы бэк штамповал `ohs.unhandled` во время recovery в ту же нить. Тело может отсутствовать.</summary>
public sealed record HoldRecoveryRequest(string? CorrelationId);

