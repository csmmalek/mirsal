import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initAppearance } from './appearance';
import { initPreferences } from './preferences';

initPreferences();
initAppearance();
createRoot(document.getElementById('root')!).render(<App />);

// Register the service worker so the app is installable (PWA / TWA). Skipped in dev.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
