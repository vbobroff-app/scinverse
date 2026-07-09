import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { OhsStore } from './core/OhsStore';
import { OhsStoreContext } from './ui/context';
import { App } from './App';
import './styles/global.css';

// Тема: по умолчанию dark (data-theme в index.html), уважаем сохранённый выбор.
const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'light' || savedTheme === 'dark') {
  document.documentElement.dataset.theme = savedTheme;
}

const store = new OhsStore();
store.start();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('#root не найден');
}

createRoot(rootElement).render(
  <StrictMode>
    <OhsStoreContext.Provider value={store}>
      <App />
    </OhsStoreContext.Provider>
  </StrictMode>,
);
