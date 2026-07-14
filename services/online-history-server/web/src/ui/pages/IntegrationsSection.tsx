import { useCallback, useEffect, useState } from 'react';
import { OhsApi } from '../../core/api';
import type { ExternalServiceDto } from '../../core/types';
import { IntegrationsPanel } from './IntegrationsPanel';
import { IntegrationWorkspace } from './IntegrationWorkspace';
import styles from './IntegrationsSection.module.css';

/**
 * Раздел «Интеграции»: слева — список внешних сервисов (API-подтвердители), в рабочей области —
 * карточка сервиса с health-check и пробным запросом расписания. Внешний сервис ≠ коннектор
 * (request/response + JWT vs stream + Basic), см. docs/dev/phase7i/schedule.md.
 */
export function IntegrationsSection() {
  const [services, setServices] = useState<ExternalServiceDto[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(() => {
    const sub = OhsApi.getIntegrations().subscribe({
      next: (list) => {
        setServices(list);
        setLoaded(true);
        setSelectedId((current) =>
          current != null && list.some((s) => s.serviceId === current)
            ? current
            : list[0]?.serviceId ?? null,
        );
      },
      error: () => setLoaded(true),
    });
    return () => sub.unsubscribe();
  }, []);

  useEffect(() => reload(), [reload]);

  const selected = services.find((s) => s.serviceId === selectedId) ?? null;

  return (
    <div className={styles.layout}>
      <IntegrationsPanel
        services={services}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onChanged={reload}
      />
      {selected ? (
        <IntegrationWorkspace service={selected} />
      ) : (
        <div className={styles.placeholder}>
          {loaded ? 'Создай интеграцию слева (кнопка +).' : 'Загрузка…'}
        </div>
      )}
    </div>
  );
}
