import { useEffect, useMemo } from 'react';
import { ExchangeCatalogStore, marketKey } from '../../core/ExchangeCatalogStore';
import { CONTRACT_TYPE_LABELS, contractType } from '../../core/futuresContract';
import { useBehavior } from '../hooks/useObservable';
import { FilterBar } from '../components/filters/FilterBar';
import { FilterChips } from '../components/filters/FilterChips';
import type { FilterMenuItem, FilterSpec } from '../components/filters/filterModel';
import styles from './ExchangeStructure.module.css';

/** Русские названия категорий базового актива (плашка «Категория»). */
const CATEGORY_LABELS: Record<string, string> = {
  index: 'Индексы',
  shares: 'Акции',
  currency: 'Валюта',
  rate: 'Ставки',
  commodity: 'Товары',
  other: 'Прочее',
};
/** Порядок категорий/типов в опциях. */
const CATEGORY_ORDER = ['index', 'shares', 'currency', 'rate', 'commodity', 'other'];
const TYPE_ORDER = ['perpetual', 'quarterly', 'monthly'];

/**
 * Раздел «Биржи → Структура»: дерево движки → рынки → борды (лениво из MOEX ISS) слева,
 * список торгуемых инструментов выбранного борда — справа. Для фьючерсов показывается класс
 * базового актива (справочник futures_asset_class), актуализируемый из ISS по кнопке.
 */
export function ExchangeStructure() {
  const store = useMemo(() => new ExchangeCatalogStore(), []);

  useEffect(() => {
    store.loadEngines();
    store.loadAssetClasses();
  }, [store]);

  const error = useBehavior(store.error$);

  return (
    <div className={styles.wrap}>
      <Toolbar store={store} />
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.panes}>
        <StructureTree store={store} />
        <SecuritiesTable store={store} />
      </div>
    </div>
  );
}

function Toolbar({ store }: { store: ExchangeCatalogStore }) {
  const refreshing = useBehavior(store.refreshing$);
  const result = useBehavior(store.refreshResult$);
  const assetClasses = useBehavior(store.assetClasses$);

  // Одна сводная подпись рядом с заголовком: после актуализации — с новыми/на проверку, иначе — итог справочника.
  const summary = result
    ? `Всего ${result.total}, новых ${result.inserted}, на проверку ${result.unresolved}`
    : `Всего ${assetClasses.size}`;

  return (
    <div className={styles.toolbar}>
      <div className={styles.toolbarInfo}>
        <span className={styles.toolbarTitle}>Классы базового актива</span>
        <span className={styles.toolbarMeta}>{summary}</span>
      </div>
      <button
        className={styles.refreshBtn}
        onClick={() => store.refreshAssetClasses()}
        disabled={refreshing}
      >
        {refreshing ? 'Актуализация…' : 'Актуализировать из ISS'}
      </button>
    </div>
  );
}

function StructureTree({ store }: { store: ExchangeCatalogStore }) {
  const engines = useBehavior(store.engines$);
  const enginesLoading = useBehavior(store.enginesLoading$);
  const expandedEngines = useBehavior(store.expandedEngines$);
  const expandedMarkets = useBehavior(store.expandedMarkets$);
  const marketsByEngine = useBehavior(store.marketsByEngine$);
  const boardsByMarket = useBehavior(store.boardsByMarket$);
  const busy = useBehavior(store.busyNodes$);
  const selected = useBehavior(store.selectedBoard$);

  return (
    <div className={styles.tree}>
      <div className={styles.treeHead}>Структура · MOEX</div>
      {enginesLoading && <div className={styles.hint}>Загрузка движков…</div>}
      {!enginesLoading && engines.length === 0 && <div className={styles.hint}>Нет данных</div>}

      <ul className={styles.nodeList}>
        {engines.map((engine) => {
          const engineOpen = expandedEngines.has(engine.name);
          const markets = marketsByEngine.get(engine.name) ?? [];
          return (
            <li key={engine.name}>
              <button className={styles.node} onClick={() => store.toggleEngine(engine.name)}>
                <Chevron open={engineOpen} />
                <span className={styles.nodeLabel}>{engine.title || engine.name}</span>
                <span className={styles.nodeCode}>{engine.name}</span>
              </button>

              {engineOpen && (
                <ul className={styles.nodeList}>
                  {busy.has(engine.name) && <li className={styles.hint}>Загрузка рынков…</li>}
                  {markets.map((market) => {
                    const key = marketKey(engine.name, market.name);
                    const marketOpen = expandedMarkets.has(key);
                    const boards = boardsByMarket.get(key) ?? [];
                    return (
                      <li key={key}>
                        <button
                          className={styles.node}
                          onClick={() => store.toggleMarket(engine.name, market.name)}
                        >
                          <Chevron open={marketOpen} />
                          <span className={styles.nodeLabel}>{market.title || market.name}</span>
                          <span className={styles.nodeCode}>{market.name}</span>
                        </button>

                        {marketOpen && (
                          <ul className={styles.nodeList}>
                            {busy.has(key) && <li className={styles.hint}>Загрузка бордов…</li>}
                            {boards.map((board) => (
                              <li key={board.boardId}>
                                <button
                                  className={[
                                    styles.leaf,
                                    selected?.board === board.boardId &&
                                    selected?.market === market.name &&
                                    selected?.engine === engine.name
                                      ? styles.leafActive
                                      : '',
                                  ]
                                    .filter(Boolean)
                                    .join(' ')}
                                  onClick={() => store.selectBoard(engine.name, market.name, board)}
                                  title={board.isTraded ? 'Торгуется' : 'Не торгуется'}
                                >
                                  <span className={styles.nodeLabel}>{board.title || board.boardId}</span>
                                  <span
                                    className={[styles.dot, board.isTraded ? styles.dotOn : styles.dotOff].join(' ')}
                                  />
                                  <span className={styles.nodeCode}>{board.boardId}</span>
                                </button>
                              </li>
                            ))}
                            {!busy.has(key) && boards.length === 0 && (
                              <li className={styles.hint}>Нет бордов</li>
                            )}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SecuritiesTable({ store }: { store: ExchangeCatalogStore }) {
  const selected = useBehavior(store.selectedBoard$);
  const securities = useBehavior(store.securities$);
  const loading = useBehavior(store.securitiesLoading$);
  const assetClasses = useBehavior(store.assetClasses$);
  const activeFilters = useBehavior(store.activeFilters$);
  const categoryFilter = useBehavior(store.categoryFilter$);
  const typeFilter = useBehavior(store.typeFilter$);
  const search = useBehavior(store.search$);

  // Набор фильтров зависит от вида инструмента: пока плашки только для FORTS-фьючерсов.
  const isFutures = selected?.engine === 'futures' && selected?.market === 'forts';

  // Обогащаем строки категорией базового актива (join по assetCode) и типом контракта.
  const enriched = useMemo(
    () =>
      securities.map((s) => {
        const code = s.assetCode?.toUpperCase();
        const hit = code ? assetClasses.get(code) : undefined;
        return {
          s,
          cat: hit?.category ?? (s.assetCode ? 'other' : ''),
          type: contractType(s),
        };
      }),
    [securities, assetClasses],
  );

  const categoryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of enriched) {
      if (e.cat) {
        counts.set(e.cat, (counts.get(e.cat) ?? 0) + 1);
      }
    }
    return CATEGORY_ORDER.filter((c) => counts.has(c)).map((c) => ({
      id: c,
      label: CATEGORY_LABELS[c] ?? c,
      count: counts.get(c),
    }));
  }, [enriched]);

  const typeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of enriched) {
      if (e.type) {
        counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
      }
    }
    return TYPE_ORDER.filter((t) => counts.has(t)).map((t) => ({
      id: t,
      label: CONTRACT_TYPE_LABELS[t as keyof typeof CONTRACT_TYPE_LABELS],
      count: counts.get(t),
    }));
  }, [enriched]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enriched
      .filter((e) => {
        if (categoryFilter.size > 0 && !categoryFilter.has(e.cat)) {
          return false;
        }
        if (typeFilter.size > 0 && !typeFilter.has(e.type)) {
          return false;
        }
        if (q) {
          const hay = `${e.s.secId} ${e.s.shortName ?? ''} ${e.s.name ?? ''}`.toLowerCase();
          if (!hay.includes(q)) {
            return false;
          }
        }
        return true;
      })
      .map((e) => e.s);
  }, [enriched, categoryFilter, typeFilter, search]);

  const available: FilterMenuItem[] = isFutures
    ? [
        { key: 'category', name: 'Категория' },
        { key: 'type', name: 'Тип' },
      ]
    : [];

  const specs = useMemo<Record<string, FilterSpec>>(
    () => ({
      category: {
        key: 'category',
        name: 'Категория',
        mode: 'multi',
        options: categoryOptions,
        selected: [...categoryFilter],
        onChange: (sel) => store.setCategoryFilter(sel),
      },
      type: {
        key: 'type',
        name: 'Тип',
        mode: 'multi',
        options: typeOptions,
        selected: [...typeFilter],
        onChange: (sel) => store.setTypeFilter(sel),
      },
    }),
    [categoryOptions, typeOptions, categoryFilter, typeFilter, store],
  );

  if (!selected) {
    return (
      <div className={styles.tableWrap}>
        <div className={styles.placeholder}>Выберите борд в дереве слева, чтобы увидеть инструменты.</div>
      </div>
    );
  }

  return (
    <div className={styles.tableWrap}>
      <div className={styles.tableHead}>
        <span className={styles.tableTitle}>{selected.title || selected.board}</span>
        <span className={styles.tableMeta}>
          {selected.engine} · {selected.market} · {selected.board}
        </span>
      </div>

      <div className={styles.filterRow}>
        <FilterBar
          key={selected.board}
          total={visible.length}
          search={{ initial: search, onSearch: (q) => store.setSearch(q) }}
        >
          <FilterChips
            available={available}
            active={activeFilters}
            specs={specs}
            onAdd={(k) => store.addFilter(k)}
            onRemove={(k) => store.removeFilter(k)}
            onClear={() => store.clearFilters()}
          />
        </FilterBar>
      </div>

      {loading && <div className={styles.hint}>Загрузка инструментов…</div>}

      {!loading && securities.length === 0 && <div className={styles.hint}>Нет торгуемых инструментов</div>}

      {!loading && securities.length > 0 && (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Код</th>
                <th>Краткое</th>
                <th>Название</th>
                <th className={styles.num}>Лот</th>
                <th className={styles.num}>Шаг цены</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => (
                <tr key={s.secId}>
                  <td className={styles.mono}>{s.secId}</td>
                  <td>{s.shortName ?? '—'}</td>
                  <td className={styles.muted}>{s.name ?? '—'}</td>
                  <td className={styles.num}>{s.lotSize ?? '—'}</td>
                  <td className={styles.num}>{s.minStep ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return <span className={[styles.chevron, open ? styles.chevronOpen : ''].filter(Boolean).join(' ')}>▸</span>;
}
