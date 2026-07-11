import { useEffect, useRef, useState } from 'react';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import type { DisplayTz } from '../../core/types';
import styles from './HeaderControls.module.css';

type Theme = 'dark' | 'light';

function currentTheme(): Theme {
  return (document.documentElement.dataset.theme as Theme) || 'dark';
}

/** Ярлык стандарта времени: МСК / UTC / UTC+N. */
function tzLabel(tz: DisplayTz): string {
  if (tz.preset === 'msk') {
    return 'МСК';
  }
  if (tz.preset === 'utc') {
    return 'UTC';
  }
  const h = Math.round(tz.offsetMin / 60);
  return `UTC${h >= 0 ? `+${h}` : h}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Правый кластер шапки: живые часы в текущем стандарте времени, переключатель темы
 * (иконка) и системные настройки (шестерёнка) с выбором единого стандарта времени.
 */
export function HeaderControls() {
  const store = useOhsStore();
  const tz = useBehavior(store.displayTz$);

  const [now, setNow] = useState(() => Date.now());
  const [theme, setTheme] = useState<Theme>(() => currentTheme());
  const [openSettings, setOpenSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!openSettings) {
      return;
    }
    const onDoc = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setOpenSettings(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenSettings(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [openSettings]);

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
    setTheme(next);
  };

  const clockMs = now + tz.offsetMin * 60_000;
  const d = new Date(clockMs);
  const clock = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  const tzHours = Math.round(tz.offsetMin / 60);

  return (
    <div className={styles.root}>
      <span className={styles.clock} title="Текущее время в выбранном стандарте">
        <span className={styles.time}>{clock}</span>
        <span className={styles.tz}>{tzLabel(tz)}</span>
      </span>

      <button
        type="button"
        className={styles.iconBtn}
        onClick={toggleTheme}
        title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
        aria-label="Переключить тему"
      >
        {theme === 'dark' ? '☀' : '☾'}
      </button>

      <div className={styles.settingsWrap} ref={settingsRef}>
        <button
          type="button"
          className={[styles.iconBtn, openSettings ? styles.iconBtnActive : ''].filter(Boolean).join(' ')}
          onClick={() => setOpenSettings((o) => !o)}
          title="Настройки системы"
          aria-label="Настройки системы"
          aria-expanded={openSettings}
        >
          <svg
            className={styles.icon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        {openSettings && (
          <div className={styles.popover}>
            <div className={styles.section}>
              <span className={styles.sectionTitle}>Стандарт времени</span>
              <div className={styles.chips}>
                <button
                  type="button"
                  className={[styles.chip, tz.preset === 'utc' ? styles.chipOn : ''].filter(Boolean).join(' ')}
                  onClick={() => store.setDisplayTz({ preset: 'utc', offsetMin: 0 })}
                >
                  UTC
                </button>
                <button
                  type="button"
                  className={[styles.chip, tz.preset === 'msk' ? styles.chipOn : ''].filter(Boolean).join(' ')}
                  onClick={() => store.setDisplayTz({ preset: 'msk', offsetMin: 180 })}
                >
                  МСК
                </button>
                <button
                  type="button"
                  className={[styles.chip, tz.preset === 'custom' ? styles.chipOn : ''].filter(Boolean).join(' ')}
                  onClick={() => store.setDisplayTz({ preset: 'custom', offsetMin: (tzHours || 8) * 60 })}
                >
                  UTC{tz.preset === 'custom' ? (tzHours >= 0 ? `+${tzHours}` : tzHours) : '+N'}
                </button>
                {tz.preset === 'custom' && (
                  <input
                    type="number"
                    className={styles.tzNum}
                    min={-12}
                    max={14}
                    value={tzHours}
                    onChange={(e) => store.setDisplayTz({ preset: 'custom', offsetMin: Number(e.target.value) * 60 })}
                  />
                )}
              </div>
              <span className={styles.hint}>Единый на всю систему: ось, тултипы, подписи.</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
