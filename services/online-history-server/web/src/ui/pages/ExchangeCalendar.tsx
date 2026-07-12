import { useEffect, useMemo, useState } from 'react';
import { OhsApi } from '../../core/api';
import { MONTHS_RU, MonthGrid, isoDate } from '../components/MonthGrid';
import type { CalendarDayDto, CalendarDayKind } from '../../core/types';
import styles from './ExchangeCalendar.module.css';

/** Сколько месяцев показываем в одном окне (пейджинг ‹/›). */
const WINDOW_MONTHS = 3;

interface Anchor {
  year: number;
  month: number; // 0..11 — первый месяц окна
}

/** Диапазон дат `[from, till]` (ISO), покрывающий окно из {@link WINDOW_MONTHS} месяцев от якоря. */
function windowRange(anchor: Anchor): { from: string; till: string } {
  const from = isoDate(anchor.year, anchor.month, 1);
  const last = new Date(anchor.year, anchor.month + WINDOW_MONTHS, 0); // последний день последнего месяца окна
  return { from, till: isoDate(last.getFullYear(), last.getMonth(), last.getDate()) };
}

/** Сдвигает якорь на `delta` месяцев (может уходить за границы года). */
function shiftAnchor(anchor: Anchor, delta: number): Anchor {
  const d = new Date(anchor.year, anchor.month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

/** Движки с торговым календарём (переключатель вверху вкладки). */
const ENGINES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'futures', label: 'Срочный (FORTS)' },
  { id: 'stock', label: 'Фондовый' },
  { id: 'currency', label: 'Валютный' },
];

/** Подпись и порядок видов дня для легенды/тултипа. */
const KIND_LABELS: Record<CalendarDayKind, string> = {
  regular: 'Торговый день',
  transfer: 'Рабочий (перенос)',
  dsvd: 'Выходной торговый (ДСВД)',
  weekend: 'Выходной',
  holiday: 'Праздник',
};
const LEGEND: CalendarDayKind[] = ['regular', 'transfer', 'dsvd', 'weekend', 'holiday'];

/** Сегодня в МСК (yyyy-MM-dd) — для подсветки текущего дня. */
function mskToday(): string {
  return new Date(Date.now() + 180 * 60_000).toISOString().slice(0, 10);
}

/** `HH:mm:ss` → `HH:mm`; null → ''. */
function hhmm(time: string | null): string {
  return time ? time.slice(0, 5) : '';
}

/**
 * Вкладка «Календарь» раздела «Структура MOEX»: месячные сетки торгового календаря движка из
 * бесплатного ISS (`/iss/engines/{engine}`). Цветом помечены праздники, ДСВД-выходные, переносы;
 * в ячейке — часы дня (МСК). Данные — те же, что питают часы оси Ганта (7c). Раскладка месяца —
 * общий {@link MonthGrid}.
 */
export function ExchangeCalendar() {
  const [engine, setEngine] = useState('futures');
  const [days, setDays] = useState<CalendarDayDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = useMemo(mskToday, []);

  // Якорь окна (первый месяц). По умолчанию — текущий месяц по МСК.
  const thisMonth = useMemo<Anchor>(() => {
    const now = new Date(Date.now() + 180 * 60_000);
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() };
  }, []);
  const [anchor, setAnchor] = useState<Anchor>(thisMonth);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const { from, till } = windowRange(anchor);
    const sub = OhsApi.getEngineCalendar(engine, from, till).subscribe({
      next: (rows) => {
        setDays(rows);
        setLoading(false);
      },
      error: () => {
        setError('MOEX ISS недоступен — не удалось загрузить календарь');
        setDays([]);
        setLoading(false);
      },
    });
    return () => sub.unsubscribe();
  }, [engine, anchor]);

  const lastMonth = shiftAnchor(anchor, WINDOW_MONTHS - 1);
  const rangeTitle = `${MONTHS_RU[anchor.month]} ${anchor.year} — ${MONTHS_RU[lastMonth.month]} ${lastMonth.year}`;
  const atToday = anchor.year === thisMonth.year && anchor.month === thisMonth.month;

  // Месяцы, присутствующие в данных, + индекс дня по ISO-дате для рендера ячеек.
  const { months, byDate } = useMemo(() => {
    const map = new Map<string, CalendarDayDto>();
    const monthKeys = new Set<string>();
    for (const d of days) {
      map.set(d.date, d);
      monthKeys.add(d.date.slice(0, 7)); // yyyy-MM
    }
    const list = [...monthKeys].sort().map((key) => {
      const [year, month] = key.split('-').map(Number);
      return { key, year, month: month - 1 };
    });
    return { months: list, byDate: map };
  }, [days]);

  const renderDay = (iso: string) => {
    const day = byDate.get(iso);
    if (!day) {
      return <span key={iso} className={styles.day}><span className={styles.dayNum}>{Number(iso.slice(8, 10))}</span></span>;
    }
    return (
      <span
        key={day.date}
        className={[styles.day, styles[day.kind], day.date === today ? styles.today : '']
          .filter(Boolean)
          .join(' ')}
        title={`${day.date} · ${KIND_LABELS[day.kind]}${
          day.isTrading && day.open ? ` · ${hhmm(day.open)}–${hhmm(day.close)}` : ''
        }`}
      >
        <span className={styles.dayNum}>{Number(day.date.slice(8, 10))}</span>
        {day.isTrading && day.open && (
          <span className={styles.dayHours}>{hhmm(day.open)}–{hhmm(day.close)}</span>
        )}
      </span>
    );
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <div className={styles.engines} role="tablist" aria-label="Движок">
          {ENGINES.map((e) => (
            <button
              key={e.id}
              className={[styles.engineBtn, engine === e.id ? styles.engineBtnActive : ''].filter(Boolean).join(' ')}
              onClick={() => setEngine(e.id)}
            >
              {e.label}
            </button>
          ))}
        </div>
        <div className={styles.legend}>
          {LEGEND.map((k) => (
            <span key={k} className={styles.legendItem}>
              <span className={[styles.swatch, styles[k]].join(' ')} />
              {KIND_LABELS[k]}
            </span>
          ))}
        </div>
      </div>

      <div className={styles.nav}>
        <button
          className={styles.navBtn}
          onClick={() => setAnchor((a) => shiftAnchor(a, -WINDOW_MONTHS))}
          aria-label="Предыдущий период"
        >
          ‹
        </button>
        <span className={styles.navTitle}>{rangeTitle}</span>
        <button
          className={styles.navBtn}
          onClick={() => setAnchor((a) => shiftAnchor(a, WINDOW_MONTHS))}
          aria-label="Следующий период"
        >
          ›
        </button>
        <button className={styles.navToday} onClick={() => setAnchor(thisMonth)} disabled={atToday}>
          Сегодня
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {loading && <div className={styles.hint}>Загрузка календаря…</div>}

      {!loading && !error && (
        <div className={styles.months}>
          {months.map((m) => (
            <div key={m.key} className={styles.month}>
              <div className={styles.monthTitle}>
                {MONTHS_RU[m.month]} {m.year}
              </div>
              <MonthGrid
                year={m.year}
                month={m.month}
                classes={{ weekdays: styles.weekHead, weekday: styles.weekDay, grid: styles.grid, empty: styles.pad }}
                renderDay={renderDay}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
