import { useState } from 'react';
import { Button } from './Button';

type Theme = 'dark' | 'light';

function currentTheme(): Theme {
  return (document.documentElement.dataset.theme as Theme) || 'dark';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => currentTheme());

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
    setTheme(next);
  };

  return (
    <Button onClick={toggle} title="Переключить тему">
      {theme === 'dark' ? '☀ Светлая' : '☾ Тёмная'}
    </Button>
  );
}
