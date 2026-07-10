// Маппинг board → биржа. Пока все источники — MOEX (FORTS/фондовый/валютный).
// Заглушка под мультибиржу: когда появятся CME/LSE/TSX, добавим их board-префиксы.
const NON_MOEX: Record<string, string> = {
  // пример на будущее: 'GLOBEX': 'CME',
};

export function exchangeForBoard(board: string | null | undefined): string {
  if (!board) {
    return 'MOEX';
  }
  return NON_MOEX[board] ?? 'MOEX';
}
