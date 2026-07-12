import type { IssSecurityDto } from './types';

/** Срок контракта фьючерса (плашка «Тип»); '' — не удалось определить. */
export type ContractType = 'perpetual' | 'quarterly' | 'monthly' | '';

/** Русские названия типов контракта для плашки/опций. */
export const CONTRACT_TYPE_LABELS: Record<Exclude<ContractType, ''>, string> = {
  perpetual: 'Бессрочные',
  quarterly: 'Квартальные',
  monthly: 'Месячные',
};

/**
 * Тип контракта фьючерса по данным ISS:
 * - бессрочные (perpetual) — тикер вида `…F` (напр. `USDRUBF`, `CNYRUBF`, `IMOEXF`) или без экспирации;
 * - квартальные — экспирация в мартовском цикле (месяцы 3/6/9/12);
 * - месячные — экспирация в прочие месяцы.
 * Эвристика; при появлении явного признака ISS уточним.
 */
export function contractType(sec: IssSecurityDto): ContractType {
  if (/F$/.test(sec.secId) || !sec.expiration) {
    return 'perpetual';
  }
  const ms = Date.parse(sec.expiration);
  if (Number.isNaN(ms)) {
    return '';
  }
  const month = new Date(ms).getUTCMonth() + 1;
  return month === 3 || month === 6 || month === 9 || month === 12 ? 'quarterly' : 'monthly';
}
