import { useEffect, useState } from 'react';
import type { BehaviorSubject, Observable } from 'rxjs';

/** Подписка на произвольный Observable с явным начальным значением. */
export function useObservable<T>(source$: Observable<T>, initial: T): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const sub = source$.subscribe(setValue);
    return () => sub.unsubscribe();
  }, [source$]);
  return value;
}

/** Подписка на BehaviorSubject (начальное значение берётся из текущего `.value`). */
export function useBehavior<T>(subject: BehaviorSubject<T>): T {
  const [value, setValue] = useState<T>(() => subject.value);
  useEffect(() => {
    const sub = subject.subscribe(setValue);
    return () => sub.unsubscribe();
  }, [subject]);
  return value;
}
