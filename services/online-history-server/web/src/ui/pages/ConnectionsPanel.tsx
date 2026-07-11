import { useState, type MouseEvent } from 'react';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import { StatusDot } from '../components/StatusDot';
import { ConnectionForm } from '../components/ConnectionForm';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { ConnectionDto } from '../../core/types';
import styles from './ConnectionsPanel.module.css';

interface Props {
  selectedId: number | null;
  onSelect: (connectionId: number | null) => void;
}

interface MenuState {
  connection: ConnectionDto;
  x: number;
  y: number;
}

export function ConnectionsPanel({ selectedId, onSelect }: Props) {
  const store = useOhsStore();
  const connections = useBehavior(store.connections$);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ConnectionDto | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ConnectionDto | null>(null);

  const openCreate = () => {
    setEditing(null);
    setCreating((v) => !v);
  };

  const openContextMenu = (e: MouseEvent, connection: ConnectionDto) => {
    e.preventDefault();
    setMenu({ connection, x: e.clientX, y: e.clientY });
  };

  const startEdit = (connection: ConnectionDto) => {
    setMenu(null);
    setCreating(false);
    setEditing(connection);
  };

  const requestDelete = (connection: ConnectionDto) => {
    setMenu(null);
    setConfirmDelete(connection);
  };

  const doDelete = () => {
    const target = confirmDelete;
    if (!target) {
      return;
    }
    setConfirmDelete(null);
    if (editing?.connectionId === target.connectionId) {
      setEditing(null);
    }
    store.deleteConnection(target.connectionId, () => {
      if (selectedId === target.connectionId) {
        const rest = store.connections$.value;
        onSelect(rest[0]?.connectionId ?? null);
      }
    });
  };

  return (
    <aside className={styles.panel}>
      <div className={styles.header}>
        <h3 className={styles.title}>Провайдеры</h3>
        <button
          className={styles.addBtn}
          onClick={openCreate}
          title="Добавить подключение"
          aria-label="Добавить подключение"
        >
          {creating ? '×' : '+'}
        </button>
      </div>

      {creating && <ConnectionForm onClose={() => setCreating(false)} onSaved={(id) => onSelect(id)} />}
      {editing && (
        <ConnectionForm
          connection={editing}
          onClose={() => setEditing(null)}
          onSaved={(id) => onSelect(id)}
        />
      )}

      <ul className={styles.list}>
        {connections.length === 0 && <li className={styles.empty}>Нет подключений</li>}
        {connections.map((c) => (
          <li key={c.connectionId}>
            <button
              className={[styles.item, c.connectionId === selectedId ? styles.active : '']
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSelect(c.connectionId)}
              onContextMenu={(e) => openContextMenu(e, c)}
            >
              <span className={styles.info}>
                <span className={styles.name}>{c.name}</span>
                <span className={styles.kind}>{c.kind}</span>
              </span>
              <StatusDot status={c.status} />
            </button>
          </li>
        ))}
      </ul>

      {menu && (
        <>
          <div className={styles.menuBackdrop} onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div className={styles.menu} style={{ top: menu.y, left: menu.x }}>
            <button className={styles.menuItem} onClick={() => startEdit(menu.connection)}>
              <span className={styles.menuIcon} aria-hidden>✎</span> Редактировать
            </button>
            <button className={[styles.menuItem, styles.menuDanger].join(' ')} onClick={() => requestDelete(menu.connection)}>
              <span className={styles.menuIcon} aria-hidden>✕</span> Удалить
            </button>
          </div>
        </>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Удалить подключение"
          message={`Удалить подключение «${confirmDelete.name}»? Действие необратимо; активная сессия будет остановлена.`}
          confirmLabel="Удалить"
          danger
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </aside>
  );
}
