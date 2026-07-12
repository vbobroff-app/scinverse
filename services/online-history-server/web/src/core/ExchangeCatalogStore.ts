import { BehaviorSubject } from 'rxjs';
import { OhsApi, type OhsApiClient } from './api';
import type {
  AssetClassRefreshResultDto,
  BoardDto,
  EngineDto,
  FuturesAssetClassDto,
  IssSecurityDto,
  MarketDto,
} from './types';

/** Ключ рынка в кэше бордов: `engine/market`. */
export function marketKey(engine: string, market: string): string {
  return `${engine}/${market}`;
}

/** Совпадение заголовков без учёта регистра/пробелов (для «схлопывания» одноимённого борда в рынок). */
export function sameTitle(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Рынок отображается «схлопнутым» (без отдельного уровня борда), если у него ровно один борд с тем же
 * названием (напр. `Фьючерсы`/forts → `Фьючерсы`/RFUD). Это ПРАВИЛО ОТОБРАЖЕНИЯ поверх реальных данных:
 * борды всё равно грузятся, поэтому смена структуры MOEX (2-й борд / иной title) автоматически разворачивает узел.
 */
export function isCollapsedMarket(market: MarketDto, boards: readonly BoardDto[]): boolean {
  return boards.length === 1 && sameTitle(boards[0].title, market.title || market.name);
}

/** Выбранный борд (для загрузки списка инструментов). */
export interface SelectedBoard {
  engine: string;
  market: string;
  board: string;
  title: string;
}

/**
 * Стор структуры биржи (MOEX ISS): ленивое дерево движки → рынки → борды + список инструментов
 * выбранного борда. Framework-agnostic (RxJS), поверх backend-прокси `/api/exchanges/*` (кэш ISS
 * — на бэке). Данные тянем по мере раскрытия узлов и кэшируем в Map, чтобы не перезапрашивать.
 */
export class ExchangeCatalogStore {
  readonly engines$ = new BehaviorSubject<EngineDto[]>([]);
  readonly enginesLoading$ = new BehaviorSubject<boolean>(false);

  readonly marketsByEngine$ = new BehaviorSubject<ReadonlyMap<string, MarketDto[]>>(new Map());
  readonly boardsByMarket$ = new BehaviorSubject<ReadonlyMap<string, BoardDto[]>>(new Map());

  readonly expandedEngines$ = new BehaviorSubject<ReadonlySet<string>>(new Set());
  readonly expandedMarkets$ = new BehaviorSubject<ReadonlySet<string>>(new Set());
  readonly busyNodes$ = new BehaviorSubject<ReadonlySet<string>>(new Set());

  readonly selectedBoard$ = new BehaviorSubject<SelectedBoard | null>(null);
  readonly securities$ = new BehaviorSubject<IssSecurityDto[]>([]);
  readonly securitiesLoading$ = new BehaviorSubject<boolean>(false);

  readonly error$ = new BehaviorSubject<string | null>(null);

  /** Справочник классов базового актива: assetCode (UPPER) → запись. */
  readonly assetClasses$ = new BehaviorSubject<ReadonlyMap<string, FuturesAssetClassDto>>(new Map());
  readonly refreshing$ = new BehaviorSubject<boolean>(false);
  readonly refreshResult$ = new BehaviorSubject<AssetClassRefreshResultDto | null>(null);

  // --- Фильтры таблицы инструментов борда (клиентские, зависят от вида). ---
  /** Строка поиска по коду/названию (общая для всех видов). */
  readonly search$ = new BehaviorSubject<string>('');
  /** Показанные плашки-фильтры борда (ключи, напр. 'category'/'type' для фьючерсов). */
  readonly activeFilters$ = new BehaviorSubject<string[]>([]);
  /** Выбранные категории базового актива (плашка «Категория», ИЛИ). */
  readonly categoryFilter$ = new BehaviorSubject<ReadonlySet<string>>(new Set());
  /** Выбранные типы контракта (плашка «Тип», ИЛИ). */
  readonly typeFilter$ = new BehaviorSubject<ReadonlySet<string>>(new Set());

  private enginesLoaded = false;
  private assetClassesLoaded = false;

  constructor(private readonly api: OhsApiClient = OhsApi) {}

  /** Загружает движки один раз (идемпотентно). */
  loadEngines(): void {
    if (this.enginesLoaded || this.enginesLoading$.value) {
      return;
    }
    this.enginesLoaded = true;
    this.enginesLoading$.next(true);
    this.error$.next(null);
    this.api.getEngines().subscribe({
      next: (engines) => this.engines$.next(engines),
      error: (err) => {
        this.enginesLoaded = false;
        this.enginesLoading$.next(false);
        this.error$.next(describeError(err));
      },
      complete: () => this.enginesLoading$.next(false),
    });
  }

  /** Загружает справочник классов базового актива один раз (идемпотентно). */
  loadAssetClasses(): void {
    if (this.assetClassesLoaded) {
      return;
    }
    this.assetClassesLoaded = true;
    this.api.getAssetClasses().subscribe({
      next: (rows) => this.assetClasses$.next(indexAssetClasses(rows)),
      error: () => {
        this.assetClassesLoaded = false;
      },
    });
  }

  /**
   * Актуализирует справочник классов из ISS (по кнопке): запускает рефреш на бэке и
   * перечитывает справочник. Пишет итог в {@link refreshResult$}.
   */
  refreshAssetClasses(): void {
    if (this.refreshing$.value) {
      return;
    }
    this.refreshing$.next(true);
    this.refreshResult$.next(null);
    this.error$.next(null);
    this.api.refreshAssetClasses().subscribe({
      next: (result) => {
        this.refreshResult$.next(result);
        this.api.getAssetClasses().subscribe({
          next: (rows) => this.assetClasses$.next(indexAssetClasses(rows)),
        });
      },
      error: (err) => {
        this.refreshing$.next(false);
        this.error$.next(describeError(err));
      },
      complete: () => this.refreshing$.next(false),
    });
  }

  /** Категория базового актива для инструмента по его ASSETCODE (или null, если нет в справочнике). */
  categoryOf(security: IssSecurityDto): FuturesAssetClassDto | null {
    if (!security.assetCode) {
      return null;
    }
    return this.assetClasses$.value.get(security.assetCode.toUpperCase()) ?? null;
  }

  /** Раскрывает/сворачивает движок; при первом раскрытии лениво тянет рынки. */
  toggleEngine(engine: string): void {
    const expanded = new Set(this.expandedEngines$.value);
    if (expanded.has(engine)) {
      expanded.delete(engine);
    } else {
      expanded.add(engine);
      if (!this.marketsByEngine$.value.has(engine)) {
        this.loadMarkets(engine);
      }
    }
    this.expandedEngines$.next(expanded);
  }

  /**
   * Раскрывает/сворачивает рынок; при первом раскрытии лениво тянет борды. Если рынок оказывается
   * «схлопнутым» (один одноимённый борд), сразу выбираем этот борд — узел ведёт себя как лист.
   */
  toggleMarket(engine: string, market: string): void {
    const key = marketKey(engine, market);
    const expanded = new Set(this.expandedMarkets$.value);
    if (expanded.has(key)) {
      expanded.delete(key);
    } else {
      expanded.add(key);
      const existing = this.boardsByMarket$.value.get(key);
      if (existing) {
        this.maybeAutoSelect(engine, market, existing);
      } else {
        this.loadBoards(engine, market, (boards) => this.maybeAutoSelect(engine, market, boards));
      }
    }
    this.expandedMarkets$.next(expanded);
  }

  /** Заголовок рынка из загруженного списка (для сравнения при схлопывании). */
  private marketTitle(engine: string, market: string): string {
    const found = (this.marketsByEngine$.value.get(engine) ?? []).find((m) => m.name === market);
    return found?.title || market;
  }

  /** Если рынок схлопнут (один одноимённый борд) и он ещё не выбран — выбираем его борд. */
  private maybeAutoSelect(engine: string, market: string, boards: BoardDto[]): void {
    if (boards.length !== 1 || !sameTitle(boards[0].title, this.marketTitle(engine, market))) {
      return;
    }
    const board = boards[0];
    const sel = this.selectedBoard$.value;
    if (sel && sel.engine === engine && sel.market === market && sel.board === board.boardId) {
      return;
    }
    this.selectBoard(engine, market, board);
  }

  /** Категория базового актива инструмента как код ('index'|…|'other'|'' если неизвестен вид). */
  categoryCodeOf(security: IssSecurityDto): string {
    const hit = this.categoryOf(security);
    return hit?.category ?? (security.assetCode ? 'other' : '');
  }

  /** Задаёт строку поиска (клиентский фильтр по коду/названию). */
  setSearch(query: string): void {
    this.search$.next(query);
  }

  /** Добавляет плашку-фильтр борда (если ещё не добавлена). */
  addFilter(key: string): void {
    if (!this.activeFilters$.value.includes(key)) {
      this.activeFilters$.next([...this.activeFilters$.value, key]);
    }
  }

  /** Убирает плашку и очищает её выбор. */
  removeFilter(key: string): void {
    this.activeFilters$.next(this.activeFilters$.value.filter((k) => k !== key));
    if (key === 'category') {
      this.categoryFilter$.next(new Set());
    } else if (key === 'type') {
      this.typeFilter$.next(new Set());
    }
  }

  /** Сбрасывает все плашки и их выбор (поиск не трогаем). */
  clearFilters(): void {
    this.activeFilters$.next([]);
    this.categoryFilter$.next(new Set());
    this.typeFilter$.next(new Set());
  }

  setCategoryFilter(categories: string[]): void {
    this.categoryFilter$.next(new Set(categories));
  }

  setTypeFilter(types: string[]): void {
    this.typeFilter$.next(new Set(types));
  }

  /** Полный сброс фильтров и поиска (при смене борда). */
  private resetFilters(): void {
    this.search$.next('');
    this.activeFilters$.next([]);
    this.categoryFilter$.next(new Set());
    this.typeFilter$.next(new Set());
  }

  /** Выбирает борд и загружает его инструменты. */
  selectBoard(engine: string, market: string, board: BoardDto): void {
    this.selectedBoard$.next({ engine, market, board: board.boardId, title: board.title });
    this.resetFilters();
    this.securities$.next([]);
    this.securitiesLoading$.next(true);
    this.error$.next(null);
    this.api.getBoardSecurities(engine, market, board.boardId).subscribe({
      next: (securities) => this.securities$.next(securities),
      error: (err) => {
        this.securitiesLoading$.next(false);
        this.error$.next(describeError(err));
      },
      complete: () => this.securitiesLoading$.next(false),
    });
  }

  private loadMarkets(engine: string): void {
    this.setBusy(engine, true);
    this.api.getMarkets(engine).subscribe({
      next: (markets) => {
        const next = new Map(this.marketsByEngine$.value);
        next.set(engine, markets);
        this.marketsByEngine$.next(next);
      },
      error: (err) => {
        this.setBusy(engine, false);
        this.error$.next(describeError(err));
      },
      complete: () => this.setBusy(engine, false),
    });
  }

  private loadBoards(engine: string, market: string, onLoaded?: (boards: BoardDto[]) => void): void {
    const key = marketKey(engine, market);
    this.setBusy(key, true);
    this.api.getBoards(engine, market).subscribe({
      next: (boards) => {
        const next = new Map(this.boardsByMarket$.value);
        next.set(key, boards);
        this.boardsByMarket$.next(next);
        onLoaded?.(boards);
      },
      error: (err) => {
        this.setBusy(key, false);
        this.error$.next(describeError(err));
      },
      complete: () => this.setBusy(key, false),
    });
  }

  private setBusy(node: string, busy: boolean): void {
    const next = new Set(this.busyNodes$.value);
    if (busy) {
      next.add(node);
    } else {
      next.delete(node);
    }
    this.busyNodes$.next(next);
  }
}

function indexAssetClasses(rows: FuturesAssetClassDto[]): ReadonlyMap<string, FuturesAssetClassDto> {
  const map = new Map<string, FuturesAssetClassDto>();
  for (const row of rows) {
    map.set(row.assetCode.toUpperCase(), row);
  }
  return map;
}

function describeError(err: unknown): string {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status?: number }).status;
    if (status === 502 || status === 504) {
      return 'MOEX ISS недоступен (проверьте доступ к сети на сервере).';
    }
  }
  return 'Не удалось загрузить данные MOEX ISS.';
}
