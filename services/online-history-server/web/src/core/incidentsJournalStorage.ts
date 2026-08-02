const SHOW_DELETED_KEY = 'ohs:incidentsJournal:showDeleted';

/** Галка «Показывать удалённые» в журнале (модалка + страница). */
export function loadIncidentsShowDeleted(): boolean {
  try {
    return localStorage.getItem(SHOW_DELETED_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveIncidentsShowDeleted(show: boolean): void {
  try {
    localStorage.setItem(SHOW_DELETED_KEY, show ? '1' : '0');
  } catch {
    // ignore quota / private mode
  }
}
