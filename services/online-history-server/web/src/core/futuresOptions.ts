import type { InstrumentDto } from './types';

/** FUT может иметь опционы даже если в БД ещё нет OPT (hasOptions=false). */
export function futuresMayHaveOptions(inst: InstrumentDto): boolean {
  if (inst.hasOptions) {
    return true;
  }
  return (inst.secType ?? '').toUpperCase() === 'FUT';
}
