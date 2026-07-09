// Цвет колбаски по коду источника (CSS-переменные из styles/variables.css).
const BY_CODE: Record<string, string> = {
  transaq: 'var(--source-transaq)',
  synthetic: 'var(--source-synthetic)',
  qscalp: 'var(--source-qscalp)',
  plaza2: 'var(--source-plaza2)',
};

export function colorForSourceCode(code: string | undefined): string {
  return (code && BY_CODE[code]) ?? 'var(--source-unknown)';
}
