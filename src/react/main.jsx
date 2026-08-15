import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.jsx';
import { ProjectProvider } from './state/ProjectContext.jsx';
import './styles/app.css';
import './styles/mobile.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ProjectProvider>
      <App />
    </ProjectProvider>
  </React.StrictMode>
);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
