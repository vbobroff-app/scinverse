import { useEffect, useMemo, useRef, useState } from 'react';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import { DateRangePicker } from './DateRangePicker';
import { SessionFilter } from './SessionFilter';
import { CalendarIcon } from './icons';
import type { TimeframeUnit } from '../../core/types';
import styles from './TimeframePanel.module.css';

interface GroupSpec {
  unit: TimeframeUnit;
  max: number;
  title: string;
}

// Группы горизонтов: D — сессии, W — недели, M/Q/Y — календарные.
const GROUPS: GroupSpec[] = [
  { unit: 'D', max: 30, title: 'Дни' },
  { unit: 'W', max: 4, title: 'Недели' },
  { unit: 'M', max: 12, title: 'Месяцы' },
  { unit: 'Q', max: 4, title: 'Кварталы' },
  { unit: 'Y', max: 10, title: 'Годы' },
];

function formatDm(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}.${m}`;
}

export function TimeframePanel() {
  const store = useOhsStore();
  const tf = useBehavior(store.timeframe$);

  const [openMenu, setOpenMenu] = useState(false);
  const [openRange, setOpenRange] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const includeWeekends = tf.kind === 'sessions' || tf.kind === 'range' ? tf.includeWeekends : true;

  // Текущий посессионный выбор (для подписи кнопки, даже когда активны All/диапазон).
  const [current, setCurrent] = useState<{ unit: TimeframeUnit; count: number }>(
    tf.kind === 'sessions' ? { unit: tf.unit, count: tf.count } : { unit: 'D', count: 1 },
  );

  useEffect(() => {
    if (tf.kind === 'sessions') {
      setCurrent({ unit: tf.unit, count: tf.count });
    }
  }, [tf]);

  useEffect(() => {
    if (!openMenu && !openRange) {
      return;
    }
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpenMenu(false);
        setOpenRange(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [openMenu, openRange]);

  const selectCount = (unit: TimeframeUnit, count: number) => {
    store.setSessionsTimeframe(unit, count);
    setCurrent({ unit, count });
    setOpenMenu(false);
  };

  const rangeLabel = useMemo(
    () => (tf.kind === 'range' ? `${formatDm(tf.from)}–${formatDm(tf.to)}` : null),
    [tf],
  );

  const triggerLabel = `${current.unit}${current.count}`;

  return (
    <div className={styles.panel} ref={rootRef}>
      <div className={styles.chipWrap}>
        <button
          type="button"
          className={[styles.chip, tf.kind === 'range' ? styles.chipActive : ''].filter(Boolean).join(' ')}
          onClick={() => {
            setOpenMenu(false);
            setOpenRange((o) => !o);
          }}
          title="Произвольный диапазон дат"
          aria-expanded={openRange}
        >
          <CalendarIcon className={styles.calIcon} />
          {rangeLabel ?? 'Диапазон'}
        </button>

        {openRange && (
          <div className={styles.rangePop}>
            <DateRangePicker
              from={tf.kind === 'range' ? tf.from : undefined}
              to={tf.kind === 'range' ? tf.to : undefined}
              onApply={(from, to) => {
                store.setTimeframe({ kind: 'range', from, to, includeWeekends });
                setOpenRange(false);
              }}
            />
          </div>
        )}
      </div>

      <div className={styles.chipWrap}>
        <button
          type="button"
          className={[styles.chip, tf.kind === 'sessions' ? styles.chipActive : ''].filter(Boolean).join(' ')}
          onClick={() => {
            setOpenRange(false);
            setOpenMenu((o) => !o);
          }}
          aria-expanded={openMenu}
          title="Горизонт истории"
        >
          {triggerLabel}
        </button>

        {openMenu && (
          <div className={styles.menu}>
            {GROUPS.map(({ unit, max }) => (
              <div key={unit} className={styles.group}>
                <div className={styles.tiles}>
                  {Array.from({ length: max }, (_, i) => i + 1).map((n) => {
                    const active = tf.kind === 'sessions' && tf.unit === unit && tf.count === n;
                    return (
                      <button
                        key={n}
                        type="button"
                        className={[styles.tile, active ? styles.tileActive : ''].filter(Boolean).join(' ')}
                        onClick={() => selectCount(unit, n)}
                      >
                        {unit}
                        {n}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        className={[styles.chip, tf.kind === 'all' ? styles.chipActive : ''].filter(Boolean).join(' ')}
        onClick={() => {
          store.setTimeframe({ kind: 'all' });
          setOpenMenu(false);
          setOpenRange(false);
        }}
        title="Всё покрытие"
      >
        All
      </button>

      <SessionFilter />
    </div>
  );
}
