/** Синие тона ленты: один hue, сильно разная насыщенность/светлота. */
const LAYER_BLUES = [
  'hsl(204 88% 58%)',
  'hsl(204 95% 72%)',
  'hsl(204 90% 38%)',
  'hsl(204 42% 55%)',
  'hsl(204 98% 78%)',
  'hsl(204 82% 30%)',
  'hsl(204 28% 60%)',
] as const;

/** Календарные (static) на доске Eye+Календарь — тот же оттенок, чуть светлее полосок confirm. */
const STATIC_PREVIEW_YELLOWS = [
  'hsl(27.1deg 16.16% 68%)',
  'hsl(27deg 16% 62%)',
  'hsl(27deg 16% 74%)',
  'hsl(27deg 14% 56%)',
] as const;

export function layerTone(layerIndex: number): string {
  return LAYER_BLUES[((layerIndex % LAYER_BLUES.length) + LAYER_BLUES.length) % LAYER_BLUES.length];
}

/** Static на preview-доске (View+Календарь). */
export function staticPreviewTone(layerIndex: number): string {
  return STATIC_PREVIEW_YELLOWS[
    ((layerIndex % STATIC_PREVIEW_YELLOWS.length) + STATIC_PREVIEW_YELLOWS.length) %
      STATIC_PREVIEW_YELLOWS.length
  ];
}
