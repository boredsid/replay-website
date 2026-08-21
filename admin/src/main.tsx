import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { initializePwaInstallPrompt } from './lib/pwa';
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/space-grotesk/wght.css';
import './index.css';

initializePwaInstallPrompt();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('[pwa] service worker registration failed', error);
    });
  });
}
