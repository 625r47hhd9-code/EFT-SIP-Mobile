import {
  createPriceCatalogPayload,
  createProjectPayload,
  safeFilePart,
  validatePriceCatalog,
  validateProject
} from './storage/project-schema.js';
import { downloadJson, loadAutosave, readJsonFile, saveAutosave } from './storage/project-storage.js';
import './upgrades/v44.js';

window.EFTStorage = {
  createPriceCatalogPayload,
  createProjectPayload,
  downloadJson,
  loadAutosave,
  readJsonFile,
  safeFilePart,
  saveAutosave,
  validatePriceCatalog,
  validateProject
};

document.documentElement.dataset.eftApp = 'vite-pwa';
window.dispatchEvent(new CustomEvent('eft-storage-ready'));

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => {
      console.warn('Service worker registration failed', error);
    });
  });
}
