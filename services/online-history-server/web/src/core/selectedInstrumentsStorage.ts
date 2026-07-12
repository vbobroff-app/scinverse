const STORAGE_KEY = 'ohs:selectedInstruments';

/** Загружает id инструментов, помеченных звёздочкой (пусто, если ничего не сохранено). */
export function loadSelectedInstruments(): ReadonlySet<number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    const ids = parsed.filter((id): id is number => typeof id === 'number' && Number.isFinite(id));
    return new Set(ids);
  } catch {
    return new Set();
  }
}

/** Сохраняет текущий набор выделенных инструментов. */
export function persistSelectedInstruments(ids: ReadonlySet<number>): void {
  try {
    if (ids.size === 0) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids].sort((a, b) => a - b)));
  } catch {
    // localStorage недоступен (приватный режим, тесты) — игнорируем.
  }
}
