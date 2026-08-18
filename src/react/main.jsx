import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.jsx';
import { ProjectProvider } from './state/ProjectContext.jsx';
import './styles/app.css';
import './styles/mobile.css';
import { registerFreshServiceWorker } from '../register-service-worker.js';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ProjectProvider>
      <App />
    </ProjectProvider>
  </React.StrictMode>
);


registerFreshServiceWorker();

// В установленном мобильном приложении браузер может разрешить жёсткую фиксацию портретной ориентации.
window.addEventListener('load', () => { screen.orientation?.lock?.('portrait').catch?.(() => {}); });
