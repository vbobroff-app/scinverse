import type { ComponentType } from 'react';
import type { IconProps } from '../components/icons';
import styles from './PlaceholderSection.module.css';

interface Props {
  icon: ComponentType<IconProps>;
  title: string;
  description: string;
}

/** Задел под будущий раздел: крупная иконка + название + краткое пояснение. */
export function PlaceholderSection({ icon: Icon, title, description }: Props) {
  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <Icon className={styles.icon} />
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.desc}>{description}</p>
        <span className={styles.badge}>Скоро</span>
      </div>
    </div>
  );
}
