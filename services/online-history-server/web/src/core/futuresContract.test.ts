import { contractType, optionSeries } from './futuresContract';
import type { IssSecurityDto } from './types';

function sec(secId: string, expiration: string | null): IssSecurityDto {
  return {
    secId,
    shortName: null,
    name: null,
    minStep: null,
    lotSize: null,
    decimals: null,
    assetCode: null,
    expiration,
    secType: null,
  };
}

describe('contractType — срок фьючерса', () => {
  it('бессрочный: тикер …F или без экспирации', () => {
    expect(contractType(sec('USDRUBF', '2030-01-01'))).toBe('perpetual');
    expect(contractType(sec('IMOEXF', null))).toBe('perpetual');
    expect(contractType(sec('SiU6', null))).toBe('perpetual');
  });

  it('квартальный: мар/июн/сен/дек', () => {
    expect(contractType(sec('SiU6', '2026-09-18'))).toBe('quarterly');
    expect(contractType(sec('SiH7', '2027-03-18'))).toBe('quarterly');
  });

  it('месячный: прочие месяцы', () => {
    expect(contractType(sec('SiN6', '2026-07-16'))).toBe('monthly');
  });
});

describe('optionSeries — серия опциона (по реальным SECID ISS)', () => {
  it('недельные: «W»-хвост A..E после цифры года', () => {
    expect(optionSeries(sec('Si80000BG6A', '2026-07-02'))).toBe('weekly');
    expect(optionSeries(sec('Si76000BF6D', '2026-06-25'))).toBe('weekly');
  });

  it('квартальные: без хвоста, экспирация мар/июн/сен/дек', () => {
    expect(optionSeries(sec('Si79000BI6', '2026-09-17'))).toBe('quarterly');
    expect(optionSeries(sec('SR28000BI6', '2026-09-16'))).toBe('quarterly');
  });

  it('месячные: без хвоста, прочие месяцы', () => {
    expect(optionSeries(sec('Si78000BG6', '2026-07-16'))).toBe('monthly');
  });
});
