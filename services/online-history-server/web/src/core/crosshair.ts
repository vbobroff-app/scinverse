import { BehaviorSubject } from 'rxjs';

/**
 * Состояние вертикального «прицела» оси. Публикуется дорожкой Ганта (`CoverageTrack`) на наведение
 * (в т.ч. по пустой дорожке без сделок), рисуется единственным оверлеем `CrosshairOverlay`: линия
 * по X курсора через все дорожки + подпись времени у оси. Отдельный стор — чтобы не ре-рендерить
 * строки списка.
 */
export interface Crosshair {
  /** X курсора (viewport, px). */
  x: number;
  /** Горизонтальные границы колонки дорожек (viewport, px) — для клампа линии. */
  trackLeft: number;
  trackRight: number;
  /** Момент времени под курсором (ms, UTC). */
  ms: number;
  /** Единый стандарт времени отображения (смещение от UTC, минуты). */
  tzOffsetMin: number;
  /** Курсор на правом крае окна — полночь показываем как «24:00», а не «00:00». */
  atEnd: boolean;
}

export const crosshair$ = new BehaviorSubject<Crosshair | null>(null);

export function showCrosshair(c: Crosshair): void {
  crosshair$.next(c);
}

export function hideCrosshair(): void {
  if (crosshair$.value !== null) {
    crosshair$.next(null);
  }
}
