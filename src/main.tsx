import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { appUpdates } from './lib/appUpdates';
import { appearance } from './lib/appearance';

appearance.start();
appUpdates.start();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
