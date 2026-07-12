import { useEffect, useMemo, useState } from 'react';
import { OhsApi } from '../../core/api';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import { Button } from './Button';
import type { ConnectionDto } from '../../core/types';
import styles from './ConnectionForm.module.css';

type Kind = 'transaq' | 'synthetic';

interface Props {
  onClose: () => void;
  onSaved: (connectionId: number) => void;
  /** Если задан — форма в режиме редактирования (префилл + PUT). */
  connection?: ConnectionDto | null;
}

const DEFAULT_TRANSAQ = {
  host: '',
  port: '',
  dllPath: 'txmlconnector.dll',
  logDir: 'logs/transaq',
  logLevel: '2',
  connectTimeoutSeconds: '30',
};

/** Разбирает JSON настроек transaq в строковые поля формы (с дефолтами). */
function parseTransaq(settings: string): typeof DEFAULT_TRANSAQ {
  try {
    const s = JSON.parse(settings || '{}') as Record<string, unknown>;
    const str = (v: unknown, d: string) => (v == null ? d : String(v));
    return {
      host: str(s.host, ''),
      port: str(s.port, ''),
      dllPath: str(s.dllPath, DEFAULT_TRANSAQ.dllPath),
      logDir: str(s.logDir, DEFAULT_TRANSAQ.logDir),
      logLevel: str(s.logLevel, DEFAULT_TRANSAQ.logLevel),
      connectTimeoutSeconds: str(s.connectTimeoutSeconds, DEFAULT_TRANSAQ.connectTimeoutSeconds),
    };
  } catch {
    return { ...DEFAULT_TRANSAQ };
  }
}

export function ConnectionForm({ onClose, onSaved, connection }: Props) {
  const store = useOhsStore();
  const sources = useBehavior(store.sources$);
  const isEdit = connection != null;

  const [name, setName] = useState(connection?.name ?? '');
  const [kind, setKind] = useState<Kind>((connection?.kind as Kind) ?? 'transaq');
  const [sourceId, setSourceId] = useState<number | ''>(connection?.sourceId ?? '');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [t, setT] = useState(() =>
    connection ? parseTransaq(connection.settings) : { ...DEFAULT_TRANSAQ },
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isTransaq = kind === 'transaq';

  // ВРЕМЕННО (dev): префилл кред из appsettings.Local.json, если заданы.
  useEffect(() => {
    if (!isTransaq) {
      return;
    }
    const sub = OhsApi.getTransaqLocalDefaults().subscribe({
      next: (defaults) => {
        if (defaults.login) {
          setLogin(defaults.login);
        }
        if (defaults.password) {
          setPassword(defaults.password);
        }
      },
    });
    return () => sub.unsubscribe();
  }, [isTransaq]);

  // Автоподбор источника под тип коннектора (по коду), иначе первый доступный.
  const resolvedSourceId = useMemo<number | ''>(() => {
    if (sourceId !== '') {
      return sourceId;
    }
    const byCode = sources.find((s) => s.code === kind);
    return byCode?.sourceId ?? sources[0]?.sourceId ?? '';
  }, [sourceId, sources, kind]);

  // При создании transaq креды обязательны; при редактировании — опциональны (пусто = не менять).
  const credsProvided = login.trim().length > 0 && password.length > 0;
  const credsOk = !isTransaq || isEdit || credsProvided;
  const canSave = !busy && name.trim().length > 0 && resolvedSourceId !== '' && credsOk;

  const submit = () => {
    if (!canSave) {
      return;
    }
    const settings = isTransaq
      ? JSON.stringify({
          host: t.host.trim(),
          port: Number(t.port) || 0,
          dllPath: t.dllPath.trim(),
          logDir: t.logDir.trim(),
          logLevel: Number(t.logLevel) || 0,
          connectTimeoutSeconds: Number(t.connectTimeoutSeconds) || 30,
        })
      : '{}';

    const request = {
      sourceId: resolvedSourceId as number,
      name: name.trim(),
      kind,
      settings,
      enabled: true,
    };
    const creds = isTransaq && credsProvided ? { login: login.trim(), password } : null;

    setBusy(true);
    setError(null);
    const callbacks = {
      onSuccess: (c: ConnectionDto) => {
        setBusy(false);
        onSaved(c.connectionId);
        onClose();
      },
      onError: (message: string) => {
        setBusy(false);
        setError(message || 'Проверка подключения не пройдена');
      },
    };

    if (isEdit) {
      store.updateConnection(connection.connectionId, request, creds, callbacks);
    } else {
      store.createConnection(request, creds, callbacks);
    }
  };

  return (
    <div className={styles.form}>
      <div className={styles.row}>
        <label className={styles.label}>Название</label>
        <input
          className={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Например: Transaq (боевой)"
          autoFocus
        />
      </div>

      <div className={styles.row}>
        <label className={styles.label}>Тип</label>
        <select className={styles.input} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          <option value="transaq">transaq</option>
          <option value="synthetic">synthetic</option>
        </select>
      </div>

      <div className={styles.row}>
        <label className={styles.label}>Источник</label>
        <select
          className={styles.input}
          value={resolvedSourceId}
          onChange={(e) => setSourceId(e.target.value ? Number(e.target.value) : '')}
        >
          {sources.length === 0 && <option value="">нет источников</option>}
          {sources.map((s) => (
            <option key={s.sourceId} value={s.sourceId}>
              {s.name ?? s.code} (#{s.sourceId})
            </option>
          ))}
        </select>
      </div>

      {isTransaq && (
        <>
          <div className={styles.grid}>
            <div className={styles.row}>
              <label className={styles.label}>Host</label>
              <input className={styles.input} value={t.host} onChange={(e) => setT({ ...t, host: e.target.value })} placeholder="tr1.finam.ru" />
            </div>
            <div className={styles.row}>
              <label className={styles.label}>Port</label>
              <input className={styles.input} value={t.port} onChange={(e) => setT({ ...t, port: e.target.value })} placeholder="3900" />
            </div>
            <div className={styles.row}>
              <label className={styles.label}>DLL-путь</label>
              <input className={styles.input} value={t.dllPath} onChange={(e) => setT({ ...t, dllPath: e.target.value })} />
            </div>
            <div className={styles.row}>
              <label className={styles.label}>Лог-директория</label>
              <input className={styles.input} value={t.logDir} onChange={(e) => setT({ ...t, logDir: e.target.value })} />
            </div>
            <div className={styles.row}>
              <label className={styles.label}>Log level</label>
              <input className={styles.input} value={t.logLevel} onChange={(e) => setT({ ...t, logLevel: e.target.value })} />
            </div>
            <div className={styles.row}>
              <label className={styles.label}>Таймаут connect, с</label>
              <input
                className={styles.input}
                value={t.connectTimeoutSeconds}
                onChange={(e) => setT({ ...t, connectTimeoutSeconds: e.target.value })}
              />
            </div>
          </div>

          <div className={styles.row}>
            <label className={styles.label}>Логин</label>
            <input
              className={styles.input}
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder={isEdit ? 'оставьте пустым — не менять' : 'Логин TRANSAQ'}
              autoComplete="off"
            />
          </div>
          <div className={styles.row}>
            <label className={styles.label}>Пароль</label>
            <input
              className={styles.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isEdit ? 'оставьте пустым — не менять' : 'Пароль TRANSAQ'}
              autoComplete="new-password"
            />
          </div>
        </>
      )}

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.actions}>
        <Button variant="primary" onClick={submit} disabled={!canSave}>
          {busy ? 'Проверка…' : isEdit ? 'Сохранить' : 'Создать'}
        </Button>
        <Button onClick={onClose} disabled={busy}>
          Отмена
        </Button>
      </div>
    </div>
  );
}
