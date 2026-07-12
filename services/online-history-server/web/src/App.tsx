import { useOhsStore } from './ui/context';
import { useBehavior } from './ui/hooks/useObservable';
import { HeaderControls } from './ui/components/HeaderControls';
import { IconSidebar } from './ui/components/IconSidebar';
import { ProvidersSection } from './ui/pages/ProvidersSection';
import { ExchangesSection } from './ui/pages/ExchangesSection';
import { PlaceholderSection } from './ui/pages/PlaceholderSection';
import { NAV_ICONS } from './ui/navigation';
import { navSection, type NavSectionId } from './core/navigation';
import styles from './App.module.css';

/** Заглушки-заделы: краткое описание будущих разделов (реальный контент появится в своих фазах). */
const PLACEHOLDER_TEXT: Partial<Record<NavSectionId, string>> = {
  news: 'Лента новостей и торговых событий с бирж (MOEX ISS). Phase 7c.',
  messages: 'Внутренние сообщения и системные уведомления сервиса. Phase 11.',
  help: 'Справка по админке: горячие клавиши, документация, статус сервисов.',
  notifications: 'Центр уведомлений — сквозная лента событий записи и соединений. Phase 11.',
  user: 'Профиль, роли и настройки пользователя. Phase 10 (auth).',
};

export function App() {
  const store = useOhsStore();
  const section = useBehavior(store.activeSection$);

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.logo}>Scinverse</span>
          <span className={styles.sub}>OHS · админка записи</span>
        </div>
        <HeaderControls />
      </header>

      <div className={styles.body}>
        <IconSidebar />
        <SectionContent section={section} />
      </div>
    </div>
  );
}

function SectionContent({ section }: { section: NavSectionId }) {
  if (section === 'providers') {
    return <ProvidersSection />;
  }
  if (section === 'exchanges') {
    return <ExchangesSection />;
  }
  const meta = navSection(section);
  return (
    <PlaceholderSection
      icon={NAV_ICONS[section]}
      title={meta.label}
      description={PLACEHOLDER_TEXT[section] ?? 'Раздел в разработке.'}
    />
  );
}
