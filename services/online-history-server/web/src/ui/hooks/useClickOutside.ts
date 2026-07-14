import { useEffect, type RefObject } from 'react';

/**
 * Вызывает {@link onOutside} при клике мышью вне элемента {@link ref}. Клики по элементам,
 * подходящим под {@link ignoreSelector} (напр. кнопка-переключатель `[+]`), игнорируются — иначе
 * форма закрылась бы и тут же переоткрылась собственным обработчиком кнопки.
 *
 * Слушаем `mousedown` (а не `click`), чтобы закрытие срабатывало до всплытия кликов внутри поповеров.
 * Элементы-потомки (в т.ч. поповер `DatePicker`, отрисованный внутри формы) считаются «внутри».
 */
export function useClickOutside<T extends HTMLElement>(
  ref: RefObject<T | null>,
  onOutside: () => void,
  ignoreSelector?: string,
): void {
  useEffect(() => {
    const handleDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || !ref.current || ref.current.contains(target)) {
        return;
      }
      if (ignoreSelector && target.closest(ignoreSelector)) {
        return;
      }
      onOutside();
    };

    document.addEventListener('mousedown', handleDown);
    return () => document.removeEventListener('mousedown', handleDown);
  }, [ref, onOutside, ignoreSelector]);
}
