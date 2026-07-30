const STORAGE_KEY = 'ohs.admin.clientId';

/** Fallback, если sessionStorage недоступен (private mode / SSR). */
let memoryClientId: string | null = null;

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ohs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Стабильный id вкладки админки для дедупа POST /recovery/outage (crash-dispatch D6).
 * sessionStorage — один id на вкладку; не общий для всех окон браузера.
 */
export function getAdminClientId(): string {
  try {
    const existing = sessionStorage.getItem(STORAGE_KEY);
    if (existing && existing.trim()) {
      return existing.trim();
    }
    const id = newId();
    sessionStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    if (memoryClientId === null) {
      memoryClientId = newId();
    }
    return memoryClientId;
  }
}
