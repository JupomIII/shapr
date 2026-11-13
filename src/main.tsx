import { createRoot } from 'react-dom/client';
import App from './ui/App';
import './styles.css';
import * as store from './state/store';
import * as ops from './state/ops';
import * as create from './sketch/create';
import * as geometry from './sketch/geometry';
import * as exporters from './kernel/exporters';
import { viewportRef } from './render/viewportRef';

const root = createRoot(document.getElementById('root')!);
root.render(<App />);

// Development-only handle for exercising the model from the console.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__shapr = {
    S: store,
    OPS: ops,
    create,
    geometry,
    exporters,
    vp: viewportRef,
  };
}

// Offline support: register the service worker in production builds only.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const url = new URL('sw.js', document.baseURI).toString();
    navigator.serviceWorker.register(url, { scope: './' }).catch(() => {
      /* offline mode simply stays unavailable */
    });
  });
}
