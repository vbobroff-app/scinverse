import { useEffect, useMemo, useState } from 'react';
import { ExchangeCatalogStore, marketKey } from '../../core/ExchangeCatalogStore';
import { useBehavior } from '../hooks/useObservable';
import styles from './ExchangeStructure.module.css';

/** Русские названия категорий класса базового актива (для плашек/колонки). */
const CATEGORY_LABELS: Record<string, string> = {
  index: 'Индексы',
  shares: 'Акции',
  currency: 'Валюта',
  rate: 'Ставки',
  commodity: 'Товары',
  other: 'Прочее',
};

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

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

  return (
    <div className={styles.toolbar}>
      <span className={styles.toolbarTitle}>Классы базового актива</span>
      <span className={styles.toolbarMeta}>{assetClasses.size} кодов в справочнике</span>
      <button
        className={styles.refreshBtn}
        onClick={() => store.refreshAssetClasses()}
        disabled={refreshing}
      >
        {refreshing ? 'Актуализация…' : 'Актуализировать из ISS'}
      </button>
      {result && !refreshing && (
        <span className={styles.toolbarResult}>
          Всего {result.total}, новых {result.inserted}, на проверку {result.unresolved}
        </span>
      )}
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
  const [category, setCategory] = useState<string | null>(null);

  // Категория каждого инструмента по ASSETCODE (для фьючерсов); прочие рынки → без категории.
  const categoryOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of securities) {
      const code = s.assetCode?.toUpperCase();
      const hit = code ? assetClasses.get(code) : undefined;
      map.set(s.secId, hit?.category ?? (s.assetCode ? 'other' : ''));
    }
    return map;
  }, [securities, assetClasses]);

  // Плашки категорий, присутствующих в выборке, с количеством (динамический фильтр).
  const chips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of securities) {
      const cat = categoryOf.get(s.secId) ?? '';
      if (cat) {
        counts.set(cat, (counts.get(cat) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [securities, categoryOf]);

  const visible = category
    ? securities.filter((s) => categoryOf.get(s.secId) === category)
    : securities;

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
          {!loading && ` · ${visible.length}${category ? ` из ${securities.length}` : ''}`}
        </span>
      </div>

      {!loading && chips.length > 0 && (
        <div className={styles.chips}>
          <button
            className={[styles.chip, category === null ? styles.chipActive : ''].filter(Boolean).join(' ')}
            onClick={() => setCategory(null)}
          >
            Все · {securities.length}
          </button>
          {chips.map(([cat, count]) => (
            <button
              key={cat}
              className={[styles.chip, category === cat ? styles.chipActive : ''].filter(Boolean).join(' ')}
              onClick={() => setCategory(category === cat ? null : cat)}
            >
              {categoryLabel(cat)} · {count}
            </button>
          ))}
        </div>
      )}

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
                <th>Категория</th>
                <th className={styles.num}>Лот</th>
                <th className={styles.num}>Шаг цены</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => {
                const cat = categoryOf.get(s.secId) ?? '';
                return (
                  <tr key={s.secId}>
                    <td className={styles.mono}>{s.secId}</td>
                    <td>{s.shortName ?? '—'}</td>
                    <td className={styles.muted}>{s.name ?? '—'}</td>
                    <td>{cat ? <span className={styles.tag}>{categoryLabel(cat)}</span> : '—'}</td>
                    <td className={styles.num}>{s.lotSize ?? '—'}</td>
                    <td className={styles.num}>{s.minStep ?? '—'}</td>
                  </tr>
                );
              })}
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
