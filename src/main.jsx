import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { supabase } from './lib/supabase.js';
import './index.css';

let swReg = null;
const check = () => swReg?.update(); // pide al navegador comprobar si hay sw.js nuevo

// autoUpdate hace skipWaiting+clientsClaim en el propio SW: el SW nuevo se activa
// solo, pero la pestaña sigue con el JS viejo ya cargado en memoria hasta recargar.
// Con injectRegister:false nadie recarga por nosotros, así que lo hacemos aquí:
// al tomar el control un SW nuevo (controllerchange) recargamos una vez. Se omite
// la 1ª instalación (sin controller previo) para no recargar en la primera visita.
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
    if (r) setInterval(check, 60 * 60 * 1000); // sesión larga abierta: busca deploy cada hora
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
