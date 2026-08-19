const RELEASE = 'm7.9.4';

export function registerFreshServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register(`./sw.js?v=${RELEASE}`, {
        updateViaCache: 'none'
      });
      await registration.update();

      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }

      // Re-check periodically while the app remains open.
      window.setInterval(() => registration.update().catch(() => {}), 60_000);
    } catch (error) {
      console.warn('Service worker registration failed', error);
    }
  });
}
