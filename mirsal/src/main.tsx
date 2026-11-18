import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initAppearance } from './appearance';

initAppearance();
createRoot(document.getElementById('root')!).render(<App />);
