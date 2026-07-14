import { useState, type MouseEvent } from 'react';
import { OhsApi } from '../../core/api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { IntegrationForm } from '../components/IntegrationForm';
import type { ExternalServiceDto } from '../../core/types';
import styles from './IntegrationsPanel.module.css';

interface Props {
  services: ExternalServiceDto[];
  selectedId: number | null;
  onSelect: (serviceId: number | null) => void;
  /** Перезагрузить список после создания/изменения/удаления. */
  onChanged: () => void;
}

interface MenuState {
  service: ExternalServiceDto;
  x: number;
  y: number;
}

export function IntegrationsPanel({ services, selectedId, onSelect, onChanged }: Props) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ExternalServiceDto | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ExternalServiceDto | null>(null);

  const openCreate = () => {
    setEditing(null);
    setCreating((v) => !v);
  };

  const startEdit = (service: ExternalServiceDto) => {
    setMenu(null);
    setCreating(false);
    setEditing(service);
  };

  const doDelete = () => {
    const target = confirmDelete;
    if (!target) {
      return;
    }
    setConfirmDelete(null);
    if (editing?.serviceId === target.serviceId) {
      setEditing(null);
    }
    OhsApi.deleteIntegration(target.serviceId).subscribe({
      next: () => {
        if (selectedId === target.serviceId) {
          onSelect(null);
        }
        onChanged();
      },
    });
  };

  const openContextMenu = (e: MouseEvent, service: ExternalServiceDto) => {
    e.preventDefault();
    setMenu({ service, x: e.clientX, y: e.clientY });
  };

  return (
    <aside className={styles.panel}>
      <div className={styles.header}>
        <h3 className={styles.title}>Интеграции</h3>
        <button
          className={styles.addBtn}
          onClick={openCreate}
          title="Добавить интеграцию"
          aria-label="Добавить интеграцию"
          data-int-add
        >
          {creating ? '×' : '+'}
        </button>
      </div>

      {creating && (
        <IntegrationForm
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            onChanged();
            onSelect(id);
          }}
        />
      )}
      {editing && (
        <IntegrationForm
          service={editing}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            onChanged();
            onSelect(id);
          }}
        />
      )}

      <ul className={styles.list}>
        {services.length === 0 && <li className={styles.empty}>Нет интеграций</li>}
        {services.map((s) => (
          <li key={s.serviceId}>
            <button
              className={[styles.item, s.serviceId === selectedId ? styles.active : '']
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSelect(s.serviceId)}
              onContextMenu={(e) => openContextMenu(e, s)}
            >
              <span className={styles.info}>
                <span className={styles.name}>{s.name}</span>
                <span className={styles.kind}>
                  {s.adapter} · {s.transport}
                  {s.hasSecret ? '' : ' · без секрета'}
                </span>
              </span>
              <span
                className={[styles.dot, s.enabled ? styles.dotOn : styles.dotOff].join(' ')}
                title={s.enabled ? 'Включена' : 'Выключена'}
                aria-hidden
              />
            </button>
          </li>
        ))}
      </ul>

      {menu && (
        <>
          <div
            className={styles.menuBackdrop}
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div className={styles.menu} style={{ top: menu.y, left: menu.x }}>
            <button className={styles.menuItem} onClick={() => startEdit(menu.service)}>
              <span className={styles.menuIcon} aria-hidden>✎</span> Редактировать
            </button>
            <button
              className={[styles.menuItem, styles.menuDanger].join(' ')}
              onClick={() => {
                setMenu(null);
                setConfirmDelete(menu.service);
              }}
            >
              <span className={styles.menuIcon} aria-hidden>✕</span> Удалить
            </button>
          </div>
        </>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Удалить интеграцию"
          message={`Удалить интеграцию «${confirmDelete.name}»? Секрет будет стёрт. Действие необратимо.`}
          confirmLabel="Удалить"
          danger
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </aside>
  );
}
