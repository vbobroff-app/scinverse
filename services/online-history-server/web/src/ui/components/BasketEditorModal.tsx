import { useEffect, useMemo, useRef, useState } from 'react';
import { OhsApi } from '../../core/api';
import type { AvailableInstrumentDto, BasketDto } from '../../core/types';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import styles from './BasketEditorModal.module.css';

interface Props {
  connectionId: number;
  /** null = создать static; иначе правка существующего. */
  basketId: number | null;
  open: boolean;
  onClose: () => void;
}

const SEC_TYPES = [
  { id: '', label: 'Любой тип' },
  { id: 'FUT', label: 'FUT' },
  { id: 'OPT', label: 'OPT' },
  { id: 'SHARE', label: 'SHARE' },
  { id: 'BOND', label: 'BOND' },
  { id: 'CURRENCY', label: 'CURRENCY' },
  { id: 'IDX', label: 'IDX' },
];

const BOARDS = [
  { id: '', label: 'Любой board' },
  { id: 'FUT', label: 'FUT' },
  { id: 'OPTS', label: 'OPTS' },
  { id: 'ROPD', label: 'ROPD' },
  { id: 'TQBR', label: 'TQBR' },
];

const PAGE = 80;
const PREVIEW_DEBOUNCE_MS = 280;

function parsePatterns(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Модалка конструктора static-набора: Available | Match preview | спека (без Start/Auto).
 */
export function BasketEditorModal({ connectionId, basketId, open, onClose }: Props) {
  const store = useOhsStore();
  const baskets = useBehavior(store.baskets$);
  const editing = useMemo(
    () => (basketId == null ? null : baskets.find((b) => b.basketId === basketId) ?? null),
    [basketId, baskets],
  );

  const [name, setName] = useState('');
  const [patternsText, setPatternsText] = useState('');
  const [secType, setSecType] = useState('');
  const [boardId, setBoardId] = useState('');
  const [availableQ, setAvailableQ] = useState('');
  const [available, setAvailable] = useState<AvailableInstrumentDto[]>([]);
  const [availableTotal, setAvailableTotal] = useState(0);
  const [availableLoading, setAvailableLoading] = useState(false);
  const [match, setMatch] = useState<AvailableInstrumentDto[]>([]);
  const [matchLoading, setMatchLoading] = useState(false);
  const [selected, setSelected] = useState<AvailableInstrumentDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const availableOffset = useRef(0);
  const closingRef = useRef(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    closingRef.current = false;
    const src: BasketDto | null = editing;
    setName(src?.name ?? '');
    setPatternsText((src?.patterns ?? []).join('\n'));
    setSecType(src?.secType ?? '');
    setBoardId(src?.boardId ?? '');
    setSelected(null);
    setError(null);
    setAvailableQ('');
    availableOffset.current = 0;
  }, [open, editing]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Available — ленивый query active.
  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setAvailableLoading(true);
    availableOffset.current = 0;
    const handle = window.setTimeout(() => {
      OhsApi.getAvailableInstruments({
        q: availableQ || undefined,
        secType: secType || undefined,
        board: boardId || undefined,
        limit: PAGE,
        offset: 0,
      }).subscribe({
        next: (page) => {
          if (cancelled) return;
          setAvailable(page.items);
          setAvailableTotal(page.total);
          setAvailableLoading(false);
        },
        error: (err) => {
          if (cancelled) return;
          console.error('getAvailableInstruments', err);
          setAvailableLoading(false);
        },
      });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [open, availableQ, secType, boardId]);

  // Match preview по правилам.
  useEffect(() => {
    if (!open) {
      return;
    }
    const patterns = parsePatterns(patternsText);
    if (patterns.length === 0) {
      setMatch([]);
      setMatchLoading(false);
      return;
    }
    let cancelled = false;
    setMatchLoading(true);
    const handle = window.setTimeout(() => {
      OhsApi.previewBasket(connectionId, {
        patterns,
        secType: secType || null,
        boardId: boardId || null,
      }).subscribe({
        next: (rows) => {
          if (cancelled) return;
          setMatch(rows);
          setMatchLoading(false);
        },
        error: (err) => {
          if (cancelled) return;
          console.error('previewBasket', err);
          setMatchLoading(false);
        },
      });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [open, connectionId, patternsText, secType, boardId]);

  if (!open) {
    return null;
  }

  const patterns = parsePatterns(patternsText);
  const canSave = name.trim().length > 0 && patterns.length > 0 && !saving;

  const loadMoreAvailable = () => {
    if (availableLoading || available.length >= availableTotal) {
      return;
    }
    const offset = available.length;
    setAvailableLoading(true);
    OhsApi.getAvailableInstruments({
      q: availableQ || undefined,
      secType: secType || undefined,
      board: boardId || undefined,
      limit: PAGE,
      offset,
    }).subscribe({
      next: (page) => {
        setAvailable((prev) => [...prev, ...page.items]);
        setAvailableTotal(page.total);
        setAvailableLoading(false);
      },
      error: (err) => {
        console.error('getAvailableInstruments', err);
        setAvailableLoading(false);
      },
    });
  };

  const save = () => {
    if (!canSave) {
      return;
    }
    setSaving(true);
    setError(null);
    const body = {
      name: name.trim(),
      patterns,
      secType: secType || null,
      boardId: boardId || null,
      enabled: editing?.enabled ?? true,
    };
    const req =
      editing == null
        ? store.createBasket(body)
        : store.updateBasket(editing.basketId, body);
    req.subscribe({
      next: () => {
        setSaving(false);
        onClose();
      },
      error: (err) => {
        console.error('saveBasket', err);
        setError('Не удалось сохранить набор');
        setSaving(false);
      },
    });
  };

  const remove = () => {
    if (editing == null || saving) {
      return;
    }
    if (!window.confirm(`Удалить набор «${editing.name}»?`)) {
      return;
    }
    setSaving(true);
    store.deleteBasket(editing.basketId).subscribe({
      next: () => {
        setSaving(false);
        onClose();
      },
      error: (err) => {
        console.error('deleteBasket', err);
        setError('Не удалось удалить набор');
        setSaving(false);
      },
    });
  };

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !closingRef.current) {
          onClose();
        }
      }}
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={editing ? `Набор «${editing.name}»` : 'Новый набор'}
      >
        <header className={styles.head}>
          <span className={styles.headTitle}>
            {editing ? `Набор «${editing.name}»` : 'Новый набор'}
          </span>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </header>

        <div className={styles.form}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Имя</span>
            <input
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Напр. Si futures"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Тип</span>
            <select
              className={styles.select}
              value={secType}
              onChange={(e) => setSecType(e.target.value)}
            >
              {SEC_TYPES.map((o) => (
                <option key={o.id || 'any'} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Board</span>
            <select
              className={styles.select}
              value={boardId}
              onChange={(e) => setBoardId(e.target.value)}
            >
              {BOARDS.map((o) => (
                <option key={o.id || 'any'} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div />
          <label className={`${styles.field} ${styles.formWide}`}>
            <span className={styles.fieldLabel}>Glob-паттерны (OR, по одному в строке)</span>
            <textarea
              className={styles.textarea}
              value={patternsText}
              onChange={(e) => setPatternsText(e.target.value)}
              placeholder={'Si-*.*\nRTS-*.2[0-9]'}
            />
          </label>
        </div>

        <div className={styles.columns}>
          <section className={styles.col}>
            <div className={styles.colHead}>
              <span>Available</span>
              <span className={styles.colMeta}>
                {availableLoading ? '…' : `${available.length}/${availableTotal}`}
              </span>
            </div>
            <div style={{ padding: '6px 8px' }}>
              <input
                className={styles.input}
                value={availableQ}
                onChange={(e) => setAvailableQ(e.target.value)}
                placeholder="Поиск…"
              />
            </div>
            <div
              className={styles.colBody}
              onScroll={(e) => {
                const el = e.currentTarget;
                if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
                  loadMoreAvailable();
                }
              }}
            >
              {available.length === 0 && !availableLoading && (
                <div className={styles.empty}>Нет инструментов</div>
              )}
              {available.map((row) => (
                <InstrumentRow
                  key={row.instrumentId}
                  row={row}
                  active={selected?.instrumentId === row.instrumentId}
                  onSelect={() => setSelected(row)}
                />
              ))}
            </div>
          </section>

          <section className={styles.col}>
            <div className={styles.colHead}>
              <span>Match</span>
              <span className={styles.colMeta}>
                {matchLoading ? '…' : String(match.length)}
              </span>
            </div>
            <div className={styles.colBody}>
              {patterns.length === 0 && (
                <div className={styles.empty}>Задайте glob-паттерны</div>
              )}
              {patterns.length > 0 && match.length === 0 && !matchLoading && (
                <div className={styles.empty}>Нет совпадений</div>
              )}
              {match.map((row) => (
                <InstrumentRow
                  key={row.instrumentId}
                  row={row}
                  active={selected?.instrumentId === row.instrumentId}
                  onSelect={() => setSelected(row)}
                />
              ))}
            </div>
          </section>

          <section className={styles.col}>
            <div className={styles.colHead}>
              <span>Спецификация</span>
            </div>
            <div className={styles.colBody}>
              {!selected && <div className={styles.empty}>Кликните инструмент</div>}
              {selected && (
                <div className={styles.spec}>
                  <div className={styles.specTitle}>
                    {selected.shortName || selected.name || selected.ticker}
                  </div>
                  <div className={styles.specCode}>{selected.ticker}</div>
                  <div className={styles.specGrid}>
                    <span className={styles.specKey}>Тип</span>
                    <span>{selected.secType ?? '—'}</span>
                    <span className={styles.specKey}>Board</span>
                    <span>{selected.board}</span>
                    <span className={styles.specKey}>Экспирация</span>
                    <span>{selected.expiration ?? '—'}</span>
                    <span className={styles.specKey}>Имя</span>
                    <span>{selected.name ?? '—'}</span>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        <footer className={styles.footer}>
          <div>
            {editing && (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnDanger}`}
                disabled={saving}
                onClick={remove}
              >
                Удалить
              </button>
            )}
            {error && <span className={styles.error}>{error}</span>}
          </div>
          <div className={styles.footerRight}>
            <button type="button" className={styles.btn} onClick={onClose} disabled={saving}>
              Отмена
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              disabled={!canSave}
              onClick={save}
            >
              {saving ? 'Сохранение…' : 'OK'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function InstrumentRow({
  row,
  active,
  onSelect,
}: {
  row: AvailableInstrumentDto;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={[styles.row, active ? styles.rowActive : ''].filter(Boolean).join(' ')}
      onClick={onSelect}
    >
      <span className={styles.rowTicker}>{row.ticker}</span>
      <span className={styles.rowMeta}>
        {[row.secType, row.board, row.expiration].filter(Boolean).join(' · ')}
      </span>
    </button>
  );
}
