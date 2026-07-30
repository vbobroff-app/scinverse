/** Фильтр по `data.connectionId`. Пустые поля = «показывать все». */
export interface ConnectionDockFilter {
  /** Текст «Показывать Id»; пусто = не ограничивать include. */
  showIdText: string;
  /** Текст «Скрывать Id»; пусто = не exclude. При конфликте с show — hide побеждает. */
  hideIdText: string;
}

export const EMPTY_CONNECTION_FILTER: ConnectionDockFilter = {
  showIdText: '',
  hideIdText: '',
};

/** Распарсить id из input; пусто / не число → undefined. */
export function parseConnectionFilterId(text: string | undefined | null): number | undefined {
  const t = (text ?? '').trim();
  if (!t || !/^\d+$/.test(t)) {
    return undefined;
  }
  const n = Number(t);
  return Number.isSafeInteger(n) && n >= 1 ? n : undefined;
}

export function normalizeConnectionFilter(
  value: Partial<ConnectionDockFilter> | null | undefined,
): ConnectionDockFilter {
  return {
    showIdText: typeof value?.showIdText === 'string' ? value.showIdText : '',
    hideIdText: typeof value?.hideIdText === 'string' ? value.hideIdText : '',
  };
}

export function isConnectionFilterDefault(value: ConnectionDockFilter): boolean {
  return !value.showIdText.trim() && !value.hideIdText.trim();
}

export function connectionFilterSummary(value: ConnectionDockFilter): string | null {
  const show = parseConnectionFilterId(value.showIdText);
  const hide = parseConnectionFilterId(value.hideIdText);
  if (show == null && hide == null) {
    return null;
  }
  const parts: string[] = [];
  if (show != null) {
    parts.push(`id=${show}`);
  }
  if (hide != null) {
    parts.push(`id≠${hide}`);
  }
  return parts.join(' · ');
}
