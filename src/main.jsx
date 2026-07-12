import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { supabase } from './lib/supabase.js';
import './index.css';

let swReg = null;
registerSW({ immediate: true, onRegisteredSW(_url, r) { swReg = r; } });

const check = () => swReg?.update(); // busca deploy; autoUpdate reloadea si hay uno nuevo

// Abrir / traer la app al frente
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') check();
});
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
