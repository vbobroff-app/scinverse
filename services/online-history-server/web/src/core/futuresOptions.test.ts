import { describe, expect, it } from 'vitest';
import { futuresMayHaveOptions } from './futuresOptions';
import type { InstrumentDto } from './types';

function inst(overrides: Partial<InstrumentDto> = {}): InstrumentDto {
  return {
    instrumentId: 1,
    ticker: 'Si-9.26',
    board: 'RFUD',
    secType: 'FUT',
    shortName: null,
    name: null,
    minStep: 1,
    decimals: 0,
    active: true,
    recording: false,
    hasOptions: false,
    strike: null,
    optionType: null,
    expiration: null,
    ...overrides,
  };
}

describe('futuresMayHaveOptions', () => {
  it('true для FUT без OPT в БД', () => {
    expect(futuresMayHaveOptions(inst({ hasOptions: false, secType: 'FUT' }))).toBe(true);
  });

  it('true при hasOptions даже для не-FUT', () => {
    expect(futuresMayHaveOptions(inst({ hasOptions: true, secType: 'OPT' }))).toBe(true);
  });

  it('false для SHARE без опционов', () => {
    expect(futuresMayHaveOptions(inst({ hasOptions: false, secType: 'SHARE' }))).toBe(false);
  });
});
