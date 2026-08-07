import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { OhsApi } from '../../core/api';
import type { AvailableInstrumentDto, BasketDto } from '../../core/types';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import { ConfirmDialog } from './ConfirmDialog';
import { Dropdown } from './Dropdown';
import { Input } from './Input';
import { SettingsMenu } from './SettingsMenu';
import { TextArea } from './TextArea';
import { FilterSearch } from './filters/FilterSearch';
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
const DND_MIME = 'application/x-ohs-basket-instrument';

function parsePatterns(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Текст паттерна при drop: short_name as-is, иначе ticker. */
function patternFromInstrument(row: AvailableInstrumentDto): string {
  const name = row.shortName?.trim();
  return name && name.length > 0 ? name : row.ticker;
}

/** Добавить строку в glob без дублей (ignore-case). */
function appendPatternLine(text: string, line: string): string {
  const needle = line.trim();
  if (!needle) {
    return text;
  }
  const existing = parsePatterns(text);
  if (existing.some((p) => p.toLowerCase() === needle.toLowerCase())) {
    return text;
  }
  const trimmed = text.replace(/\s+$/, '');
  return trimmed.length === 0 ? needle : `${trimmed}, ${needle}`;
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
  const [matchQ, setMatchQ] = useState('');
  const [available, setAvailable] = useState<AvailableInstrumentDto[]>([]);
  const [availableTotal, setAvailableTotal] = useState(0);
  const [availableLoading, setAvailableLoading] = useState(false);
  const [match, setMatch] = useState<AvailableInstrumentDto[]>([]);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AvailableInstrumentDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** После клика OK — показать ошибки обязательных полей. */
  const [submitted, setSubmitted] = useState(false);
  const [showAvailableSearch, setShowAvailableSearch] = useState(true);
  const [showMatchSearch, setShowMatchSearch] = useState(true);
  /** Резерв: запрос спецификации (пока без эффекта). */
  const [requestSpec, setRequestSpec] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const availableOffset = useRef(0);
  const closingRef = useRef(false);
  const dragDepth = useRef(0);
  const isDraggingRef = useRef(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    closingRef.current = false;
    const src: BasketDto | null = editing;
    setName(src?.name ?? '');
    setPatternsText((src?.patterns ?? []).join(', '));
    setSecType(src?.secType ?? '');
    setBoardId(src?.boardId ?? '');
    setSelected(null);
    setError(null);
    setSubmitted(false);
    setShowAvailableSearch(true);
    setShowMatchSearch(true);
    setRequestSpec(true);
    setConfirmDelete(false);
    setAvailableQ('');
    setMatchQ('');
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

  // Available — ленивый query active (q debounce в FilterSearch).
  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setAvailableLoading(true);
    availableOffset.current = 0;
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
    return () => {
      cancelled = true;
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
      setMatchError(null);
      return;
    }
    let cancelled = false;
    setMatchLoading(true);
    setMatchError(null);
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
          setMatch([]);
          setMatchError('Превью не удалось — проверьте Host / сеть');
          setMatchLoading(false);
        },
      });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [open, connectionId, patternsText, secType, boardId]);

  const matchFiltered = useMemo(() => {
    const q = matchQ.trim().toLowerCase();
    if (!q) {
      return match;
    }
    return match.filter((row) => {
      const hay = [row.ticker, row.board, row.shortName, row.name, row.secType]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [match, matchQ]);

  if (!open) {
    return null;
  }

  const patterns = parsePatterns(patternsText);
  const nameOk = name.trim().length > 0;
  const patternsOk = patterns.length > 0;
  const formValid = nameOk && patternsOk;
  const nameInvalid = submitted && !nameOk;
  const patternsInvalid = submitted && !patternsOk;
  /** До первой попытки OK кликабелен; после ошибок — пока форма не валидна. */
  const okDisabled = saving || (submitted && !formValid);

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
    setSubmitted(true);
    if (!formValid || saving) {
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

  const requestDelete = () => {
    if (editing == null || saving) {
      return;
    }
    setConfirmDelete(true);
  };

  const doDelete = () => {
    if (editing == null) {
      return;
    }
    setConfirmDelete(false);
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

  /** Drop Available → Match: строка short_name в glob (дедуп). */
  const addInstrumentPattern = (row: AvailableInstrumentDto) => {
    if (match.some((m) => m.instrumentId === row.instrumentId)) {
      setSelected(row);
      return;
    }
    const line = patternFromInstrument(row);
    setPatternsText((prev) => {
      const next = appendPatternLine(prev, line);
      return next;
    });
    setSelected(row);
  };

  const onMatchDragEnter = (e: DragEvent) => {
    if (!isDraggingRef.current) {
      return;
    }
    e.preventDefault();
    dragDepth.current += 1;
    setDropActive(true);
  };

  const onMatchDragLeave = (e: DragEvent) => {
    if (!isDraggingRef.current) {
      return;
    }
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) {
      setDropActive(false);
    }
  };

  const onMatchDragOver = (e: DragEvent) => {
    if (!isDraggingRef.current) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const onMatchDrop = (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDropActive(false);
    setDraggingId(null);
    isDraggingRef.current = false;
    const raw = e.dataTransfer.getData(DND_MIME) || e.dataTransfer.getData('text/plain');
    if (!raw) {
      return;
    }
    try {
      const row = JSON.parse(raw) as AvailableInstrumentDto;
      if (row?.instrumentId != null && (row.ticker || row.shortName)) {
        addInstrumentPattern(row);
      }
    } catch {
      // ignore bad payload
    }
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
          <div className={styles.headActions}>
            <SettingsMenu
              sections={[
                {
                  title: 'Available',
                  items: [
                    {
                      key: 'availableSearch',
                      label: 'Поиск доступных',
                      checked: showAvailableSearch,
                      onChange: (v) => {
                        setShowAvailableSearch(v);
                        if (!v) setAvailableQ('');
                      },
                    },
                  ],
                },
                {
                  title: 'Match',
                  items: [
                    {
                      key: 'matchSearch',
                      label: 'Поиск выбранных',
                      checked: showMatchSearch,
                      onChange: (v) => {
                        setShowMatchSearch(v);
                        if (!v) setMatchQ('');
                      },
                    },
                  ],
                },
                {
                  title: 'Инфо',
                  items: [
                    {
                      key: 'requestSpec',
                      label: 'Запрашивать спецификацию',
                      checked: requestSpec,
                      onChange: setRequestSpec,
                    },
                  ],
                },
              ]}
            />
            <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Закрыть">
              ×
            </button>
          </div>
        </header>

        <div className={styles.form}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              Имя<span className={nameInvalid ? styles.reqInvalid : styles.req}>*</span>
            </span>
            <Input
              value={name}
              invalid={nameInvalid}
              onChange={(e) => setName(e.target.value)}
              placeholder="Напр. Si futures"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Тип</span>
            <Dropdown
              value={secType}
              options={SEC_TYPES.map((o) => ({ value: o.id, label: o.label }))}
              onChange={setSecType}
              aria-label="Тип"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Board</span>
            <Dropdown
              value={boardId}
              options={BOARDS.map((o) => ({ value: o.id, label: o.label }))}
              onChange={setBoardId}
              aria-label="Board"
            />
          </label>
          <div />
          <label className={`${styles.field} ${styles.formWide}`}>
            <span className={styles.fieldLabel}>
              Glob{' '}
              <span className={styles.labelKeepCase}>по short_name</span>
              <span className={patternsInvalid ? styles.reqInvalid : styles.req}>*</span>
            </span>
            <TextArea
              mono
              value={patternsText}
              invalid={patternsInvalid}
              onChange={(e) => setPatternsText(e.target.value)}
              placeholder="Si-*.*, RTS-*.2[0-9], SBRF-*.*"
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
            {showAvailableSearch && (
              <div className={styles.colFilter}>
                <FilterSearch
                  key={`available-${basketId ?? 'new'}-${open}`}
                  fullWidth
                  placeholder="Поиск…"
                  onSearch={setAvailableQ}
                />
              </div>
            )}
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
                  dragging={draggingId === row.instrumentId}
                  draggable
                  onSelect={() => setSelected(row)}
                  onDragStart={(e) => {
                    isDraggingRef.current = true;
                    setDraggingId(row.instrumentId);
                    const payload = JSON.stringify(row);
                    e.dataTransfer.setData(DND_MIME, payload);
                    e.dataTransfer.setData('text/plain', payload);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onDragEnd={() => {
                    isDraggingRef.current = false;
                    setDraggingId(null);
                    dragDepth.current = 0;
                    setDropActive(false);
                  }}
                />
              ))}
            </div>
          </section>

          <section
            className={[styles.col, dropActive ? styles.colDropTarget : ''].filter(Boolean).join(' ')}
            onDragEnter={onMatchDragEnter}
            onDragLeave={onMatchDragLeave}
            onDragOver={onMatchDragOver}
            onDrop={onMatchDrop}
          >
            <div className={styles.colHead}>
              <span>Match</span>
              <span className={styles.colMeta}>
                {matchLoading
                  ? '…'
                  : matchQ.trim()
                    ? `${matchFiltered.length}/${match.length}`
                    : String(match.length)}
              </span>
            </div>
            {showMatchSearch && (
              <div className={styles.colFilter}>
                <FilterSearch
                  key={`match-${basketId ?? 'new'}-${open}`}
                  fullWidth
                  placeholder="Поиск…"
                  onSearch={setMatchQ}
                />
              </div>
            )}
            <div className={styles.colBody}>
              {patterns.length === 0 && !dropActive && (
                <div className={styles.empty}>
                  Перетащите из Available или задайте glob
                </div>
              )}
              {dropActive && (
                <div className={styles.empty}>Отпустите — добавить в набор</div>
              )}
              {matchLoading && !dropActive && <div className={styles.empty}>Считаем Match…</div>}
              {matchError && !matchLoading && !dropActive && (
                <div className={styles.empty}>{matchError}</div>
              )}
              {patterns.length > 0 &&
                match.length === 0 &&
                !matchLoading &&
                !matchError &&
                !dropActive && (
                  <div className={styles.empty}>
                    Нет совпадений по short_name.
                    <br />
                    Обозначение MOEX: Si-*.* (не seccode SiU6).
                  </div>
                )}
              {matchQ.trim() &&
                match.length > 0 &&
                matchFiltered.length === 0 &&
                !matchLoading &&
                !dropActive && (
                  <div className={styles.empty}>Нет совпадений по фильтру</div>
                )}
              {matchFiltered.map((row) => (
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
                    <span className={styles.specKey}>Обозначение</span>
                    <span>{selected.shortName ?? '—'}</span>
                    <span className={styles.specKey}>Seccode</span>
                    <span>{selected.ticker}</span>
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
                onClick={requestDelete}
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
              disabled={okDisabled}
              onClick={save}
            >
              {saving ? 'Сохранение…' : 'OK'}
            </button>
          </div>
        </footer>
      </div>

      {confirmDelete && editing && (
        <ConfirmDialog
          title="Удалить набор"
          message={
            `Действие необратимо — инструменты выйдут из основного списка, ` +
            `записи ON/AUTO будут доступны в наборе Recording.\n` +
            `Удалить набор «${editing.name}»?`
          }
          icon={<DeleteBasketIcon />}
          confirmLabel="Удалить"
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

/** Message-box icon: красный. */
function DeleteBasketIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1.35em"
      height="1.35em"
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ color: 'var(--color-error)', flexShrink: 0 }}
    >
      <path d="M0 0h24v24H0z" fill="none" />
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2zm-10-2h.01M12 7v4"
      />
    </svg>
  );
}

function InstrumentRow({
  row,
  active,
  dragging,
  draggable: canDrag,
  onSelect,
  onDragStart,
  onDragEnd,
}: {
  row: AvailableInstrumentDto;
  active: boolean;
  dragging?: boolean;
  draggable?: boolean;
  onSelect: () => void;
  onDragStart?: (e: DragEvent) => void;
  onDragEnd?: () => void;
}) {
  return (
    <button
      type="button"
      className={[
        styles.row,
        active ? styles.rowActive : '',
        canDrag ? styles.rowDraggable : '',
        dragging ? styles.rowDragging : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={onSelect}
      draggable={canDrag}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <span className={styles.rowTicker}>{row.shortName || row.ticker}</span>
      <span className={styles.rowMeta}>
        {[row.shortName ? row.ticker : null, row.secType, row.board, row.expiration]
          .filter(Boolean)
          .join(' · ')}
      </span>
    </button>
  );
}
