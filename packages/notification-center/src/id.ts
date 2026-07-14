/** Лёгкий id без внешних зависимостей (не ULID; сортировка — по `ts`). */
export function createNotificationId(): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `${t}-${r}`;
}
