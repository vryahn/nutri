import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import * as Sentry from '@sentry/react';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { supabase } from './lib/supabase.js';
import './index.css';

// Monitoreo de errores en producción. DSN de Sentry (publicable, va en el bundle
// cliente); ausente en dev = sin ruido. Solo captura de errores: sin tracing ni replay.
if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({ dsn: import.meta.env.VITE_SENTRY_DSN });
}

let swReg = null;
// update() rechaza si la fetch de sw.js falla (red intermitente): se traga el error,
// no hay nada que hacer y reintenta en el próximo check. Sin catch = ruido en Sentry.
const check = () => swReg?.update().catch(() => {}); // comprueba si hay sw.js nuevo

// El sw.js de vite-plugin-pwa NO hace skipWaiting solo: trae un listener que espera
// un mensaje 'SKIP_WAITING' (y con injectRegister:false nadie se lo manda). Sin eso el
// SW nuevo se queda en 'waiting', el viejo sigue controlando y sirve el bundle anterior
// — de ahí "no veo el cambio" tras deployar. onRegisteredSW (abajo) activa el SW nuevo;
// al tomar el control (controllerchange) recargamos una vez para cargar el JS nuevo. Se
// omite la 1ª instalación (sin controller previo) para no recargar en la primera visita.
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing || !hadController) return;
    refreshing = true;
    window.location.reload();
  });
}

registerSW({
  immediate: true,
  onRegisteredSW(_url, r) {
    swReg = r;
    if (!r) return;
    // Activa el SW nuevo (el sw.js escucha 'SKIP_WAITING'): al arrancar si ya había uno
    // esperando, y al instalarse uno nuevo teniendo ya controller (= es un update).
    const skip = () => r.waiting?.postMessage({ type: 'SKIP_WAITING' });
    skip();
    r.addEventListener('updatefound', () => {
      const nw = r.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) skip();
      });
    });
    setInterval(check, 60 * 60 * 1000); // sesión larga abierta: busca deploy cada hora
  },
});

// Abrir / traer la app al frente
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') check();
});
// Recuperar conexión (móvil que estuvo offline)
window.addEventListener('online', check);
// Login
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_IN') check();
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
);
