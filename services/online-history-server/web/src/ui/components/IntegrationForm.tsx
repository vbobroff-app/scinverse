import { useRef, useState } from 'react';
import { OhsApi } from '../../core/api';
import { useClickOutside } from '../hooks/useClickOutside';
import { Button } from './Button';
import { DatePicker } from './DatePicker';
import type { ExternalServiceDto, IntegrationTransport, UpsertExternalServiceRequest } from '../../core/types';
import styles from './IntegrationForm.module.css';

interface Props {
  onClose: () => void;
  onSaved: (serviceId: number) => void;
  /** Если задан — режим редактирования (префилл + PUT; секрет пустой = не менять). */
  service?: ExternalServiceDto | null;
}

/** Поддерживаемые адаптеры (биндинг на код). MVP — только Finam. */
const ADAPTERS: ReadonlyArray<{ id: string; label: string }> = [{ id: 'finam', label: 'Finam' }];

const TRANSPORTS: ReadonlyArray<{ id: IntegrationTransport; label: string; ready: boolean }> = [
  { id: 'rest', label: 'REST', ready: true },
  { id: 'grpc', label: 'gRPC (скоро)', ready: false },
  { id: 'ws', label: 'WebSocket (скоро)', ready: false },
];

type ProbeState = { kind: 'idle' | 'busy' } | { kind: 'done'; ok: boolean; message: string };

export function IntegrationForm({ onClose, onSaved, service }: Props) {
  const isEdit = service != null;

  const [name, setName] = useState(service?.name ?? 'Finam REST API');
  const [adapter, setAdapter] = useState(service?.adapter ?? 'finam');
  const [transport, setTransport] = useState<IntegrationTransport>(service?.transport ?? 'rest');
  const [secret, setSecret] = useState('');
  const [expiresOn, setExpiresOn] = useState<string | null>(service?.secretExpiresOn ?? null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<ProbeState>({ kind: 'idle' });

  const formRef = useRef<HTMLDivElement>(null);
  // Клик вне формы закрывает её; кнопку `[+]` игнорируем (у неё свой тумблер). Пока идёт
  // сохранение/проверка — не закрываем, чтобы не прервать показ результата.
  useClickOutside(formRef, () => {
    if (!busy && probe.kind !== 'busy') {
      onClose();
    }
  }, '[data-int-add]');

  // При создании секрет обязателен (иначе нечем авторизоваться); при редактировании пусто = не менять.
  const canSave = !busy && name.trim().length > 0 && (isEdit || secret.trim().length > 0);

  const runProbe = (serviceId: number) => {
    setProbe({ kind: 'busy' });
    OhsApi.probeIntegration(serviceId).subscribe({
      next: (r) => setProbe({ kind: 'done', ok: r.ok, message: r.message }),
      error: () => setProbe({ kind: 'done', ok: false, message: 'Проверка не удалась' }),
    });
  };

  const submit = () => {
    if (!canSave) {
      return;
    }
    const body: UpsertExternalServiceRequest = {
      name: name.trim(),
      adapter,
      transport,
      secret: secret.trim().length > 0 ? secret.trim() : null,
      secretExpiresOn: expiresOn,
      enabled: service?.enabled ?? true,
    };

    setBusy(true);
    setError(null);
    setProbe({ kind: 'idle' });
    const request = isEdit
      ? OhsApi.updateIntegration(service.serviceId, body)
      : OhsApi.createIntegration(body);

    request.subscribe({
      next: (saved) => {
        setBusy(false);
        onSaved(saved.serviceId);
        // Health-check сразу после сохранения (auth по секрету) — «Интеграция создана», если ок.
        if (saved.hasSecret) {
          runProbe(saved.serviceId);
        }
      },
      error: (e: unknown) => {
        setBusy(false);
        setError(errorMessage(e) ?? 'Не удалось сохранить интеграцию');
      },
    });
  };

  return (
    <div className={styles.form} ref={formRef}>
      <div className={styles.row}>
        <label className={styles.label}>Название</label>
        <input
          className={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Например: Finam REST API"
          autoFocus
        />
      </div>

      <div className={styles.row}>
        <label className={styles.label}>Сервис</label>
        <select className={styles.input} value={adapter} onChange={(e) => setAdapter(e.target.value)}>
          {ADAPTERS.map((a) => (
            <option key={a.id} value={a.id}>{a.label}</option>
          ))}
        </select>
      </div>

      <div className={styles.row}>
        <label className={styles.label}>Секрет (sekret key)</label>
        <input
          className={styles.input}
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={isEdit ? 'оставьте пустым — не менять' : 'tapi_sk_…'}
          autoComplete="new-password"
        />
      </div>

      <div className={styles.row}>
        <label className={styles.label}>Дата окончания (опц.)</label>
        <DatePicker value={expiresOn} onChange={setExpiresOn} placeholder="Не задано" />
      </div>

      <div className={styles.row}>
        <label className={styles.label}>API</label>
        <select
          className={styles.input}
          value={transport}
          onChange={(e) => setTransport(e.target.value as IntegrationTransport)}
        >
          {TRANSPORTS.map((t) => (
            <option key={t.id} value={t.id} disabled={!t.ready}>{t.label}</option>
          ))}
        </select>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {probe.kind === 'busy' && <div className={styles.hint}>Проверка связи…</div>}
      {probe.kind === 'done' && (
        <div className={probe.ok ? styles.ok : styles.error}>
          {probe.ok ? `Интеграция создана · ${probe.message}` : `Не подтверждено: ${probe.message}`}
        </div>
      )}

      <div className={styles.actions}>
        <Button variant="primary" onClick={submit} disabled={!canSave}>
          {busy ? 'Сохранение…' : isEdit ? 'Сохранить' : 'Создать'}
        </Button>
        <Button onClick={onClose} disabled={busy}>
          {probe.kind === 'done' ? 'Готово' : 'Отмена'}
        </Button>
      </div>
    </div>
  );
}

/** Достаёт сообщение об ошибке из ответа rxjs/ajax (тело `{error}`), иначе — общий текст. */
function errorMessage(e: unknown): string | null {
  const response = (e as { response?: { error?: string } } | null)?.response;
  return response?.error ?? null;
}
