import { useCallback, useEffect, useState, type RefCallback } from 'react';

/**
 * Отслеживает ширину элемента (px) через ResizeObserver — для адаптивной плотности осей.
 * Callback-ref: корректно переживает unmount/remount (условный рендер линейки и т.п.).
 * При снятии элемента последняя ширина сохраняется (не сбрасываем в 0).
 */
export function useElementWidth<T extends HTMLElement>(): [RefCallback<T>, number] {
  const [node, setNode] = useState<T | null>(null);
  const [width, setWidth] = useState(0);

  const ref = useCallback((el: T | null) => {
    setNode(el);
  }, []);

  useEffect(() => {
    if (!node) {
      return;
    }
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      // Unmount/collapse часто шлёт 0 — не затираем последнюю валидную ширину.
      if (w <= 0) {
        return;
      }
      setWidth((prev) => (Math.abs(prev - w) > 0.5 ? w : prev));
    });
    ro.observe(node);
    const measured = node.getBoundingClientRect().width;
    if (measured > 0) {
      setWidth(measured);
    }
    return () => ro.disconnect();
  }, [node]);

  return [ref, width];
}
