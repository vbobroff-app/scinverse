/**
 * Справочник бирж (задел под phase 7c / MOEX ISS).
 *
 * Пока статический: реальную структуру (движки → рынки → борды + торгуемые инструменты)
 * и расписания подтянем из ISS API. `ready` — есть ли по бирже данные/поддержка сейчас.
 */

export interface ExchangeInfo {
  /** Код биржи (MIC-подобный), совпадает с `exchangeForBoard`. */
  code: string;
  /** Отображаемое имя. */
  name: string;
  /** Готова ли биржа (данные/расписание) — иначе задел под будущее. */
  ready: boolean;
}

export const EXCHANGES: readonly ExchangeInfo[] = [
  { code: 'MOEX', name: 'Московская биржа', ready: true },
  { code: 'SPBEX', name: 'СПБ Биржа', ready: false },
];
