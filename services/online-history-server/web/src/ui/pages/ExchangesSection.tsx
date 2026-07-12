import { useState } from 'react';
import { EXCHANGES } from '../../core/exchanges';
import { ExchangeIcon } from '../components/icons';
import { ExchangesPanel } from './ExchangesPanel';
import { ExchangeStructure } from './ExchangeStructure';
import { PlaceholderSection } from './PlaceholderSection';
import styles from './ExchangesSection.module.css';

/**
 * Раздел «Биржи»: слева — список бирж (панель как у провайдеров), в рабочей области —
 * структура выбранной биржи (движки → рынки → борды → инструменты) из MOEX ISS.
 */
export function ExchangesSection() {
  const [selectedCode, setSelectedCode] = useState<string | null>(EXCHANGES[0]?.code ?? null);
  const selected = EXCHANGES.find((e) => e.code === selectedCode) ?? null;

  return (
    <div className={styles.layout}>
      <ExchangesPanel selectedCode={selectedCode} onSelect={setSelectedCode} />
      {selected?.ready ? (
        <ExchangeStructure />
      ) : selected ? (
        <PlaceholderSection
          icon={ExchangeIcon}
          title={selected.name}
          description="Структура и расписание этой биржи появятся позже. Пока доступна только Московская биржа (MOEX ISS)."
        />
      ) : (
        <div className={styles.placeholder}>Выбери биржу слева.</div>
      )}
    </div>
  );
}
