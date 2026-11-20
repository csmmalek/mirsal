import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initAppearance } from './appearance';
import { initPreferences } from './preferences';

initPreferences();
initAppearance();
createRoot(document.getElementById('root')!).render(<App />);
