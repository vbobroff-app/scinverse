import { createContext, useContext } from 'react';
import type { OhsStore } from '../core/OhsStore';

export const OhsStoreContext = createContext<OhsStore | null>(null);

export function useOhsStore(): OhsStore {
  const store = useContext(OhsStoreContext);
  if (!store) {
    throw new Error('OhsStoreContext не предоставлен (оберни приложение в OhsStoreContext.Provider)');
  }
  return store;
}
