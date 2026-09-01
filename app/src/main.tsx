import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
// Latin only. The full package is a Japanese face with 229 unicode subsets, and
// the wordmark it draws is the single word REPLAY.
import '@fontsource/dela-gothic-one/latin-400.css';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    // `updateViaCache: 'none'` makes update checks bypass the HTTP cache for
    // sw.js. The zone currently serves it with `max-age=14400` despite the
    // `no-cache` rule in `public/_headers`, which would otherwise delay a
    // service-worker fix by up to four hours — during an event, that is the
    // difference between shipping a fix and not.
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .catch((error) => console.error('service_worker_registration_failed', error));
  });
}
