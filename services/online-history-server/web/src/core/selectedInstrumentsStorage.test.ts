import { afterEach, describe, expect, it } from 'vitest';
import { loadSelectedInstruments, persistSelectedInstruments } from './selectedInstrumentsStorage';

const STORAGE_KEY = 'ohs:selectedInstruments';

describe('selectedInstrumentsStorage', () => {
  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it('возвращает пустой набор, если ничего не сохранено', () => {
    expect(loadSelectedInstruments().size).toBe(0);
  });

  it('сохраняет и загружает id инструментов', () => {
    persistSelectedInstruments(new Set([42, 7, 42]));
    expect([...loadSelectedInstruments()].sort((a, b) => a - b)).toEqual([7, 42]);
  });

  it('очищает ключ при пустом наборе', () => {
    persistSelectedInstruments(new Set([1]));
    persistSelectedInstruments(new Set());
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(loadSelectedInstruments().size).toBe(0);
  });

  it('игнорирует битый JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not-json');
    expect(loadSelectedInstruments().size).toBe(0);
  });
});
