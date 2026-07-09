import { useEffect, useState } from 'react';

/** Возвращает текущее время (мс), обновляемое каждые `intervalMs` — для «ползущих» колбасок. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
