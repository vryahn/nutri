import { useEffect, useState, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom';
import { CalendarDays, Apple, ChefHat, Target, BarChart3, LogOut, Tags, MoreHorizontal } from 'lucide-react';
import { supabase } from './lib/supabase.js';
import { subscribeSectionMenu } from './lib/sectionMenu.js';
import { useOutsideClose } from './lib/useOutsideClose.js';
import { watchSystem } from './lib/theme.js';
import { t, useLang, registerLangUser } from './lib/i18n.js';
import ThemeToggle from './components/ThemeToggle.jsx';
import LangToggle from './components/LangToggle.jsx';
import Login from './pages/Login.jsx';
import Today from './pages/Today.jsx';
import Foods from './pages/Foods.jsx';
import Recipes from './pages/Recipes.jsx';
import Targets from './pages/Targets.jsx';
// Recharts (~479 kB) solo se descarga al abrir la tab.
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
import LabelsModal from './components/LabelsModal.jsx';

const TABS = [
  { to: '/', label: 'Hoy', icon: CalendarDays, end: true },
  { to: '/foods', label: 'Alimentos', icon: Apple },
  { to: '/recipes', label: 'Recetas', icon: ChefHat },
  { to: '/targets', label: 'Objetivos', icon: Target },
  { to: '/dashboard', label: 'Dashboard', icon: BarChart3 },
];

function useSession() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Registra el usuario para persistir el idioma en prefs (cross-device) y
  // aplica prefs.data.lang si difiere de lo detectado por localStorage.
  useEffect(() => {
    if (!session) return;
    supabase.from('prefs').select('data').maybeSingle().then(({ data }) => {
      registerLangUser(session.user.id, data?.data?.lang);
    });
  }, [session]);

  return session;
}

// "Más opciones": botón dinámico que anida las acciones que publica la página
// activa (setSectionMenu). Sin acciones no se renderiza. `placement` decide si
// el menú abre hacia abajo (header móvil) o hacia la derecha (sidebar, al pie).
// En ambos casos flota sobre el contenido, así que lleva `.glass`; abrirlo hacia
// arriba lo dejaba dentro del sidebar, sin nada detrás que difuminar.
// Cierre al tocar fuera: `useOutsideClose`, no un backdrop (el header es .glass).
const MENU_PLACEMENT = {
  bottom: 'top-full right-0 mt-1',
  right: 'left-full bottom-0 ml-1',
};

function MoreOptions({ actions, placement = 'bottom', className, label }) {
  useLang();
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(open, setOpen);
  if (!actions.length) return null;
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={className}
        aria-label={t('Más opciones')}
        aria-expanded={open}
      >
        <MoreHorizontal size={20} />
        {label && <span className="text-sm">{label}</span>}
      </button>
      {open && (
        <div
          className={`absolute z-50 min-w-44 rounded-xl border border-border p-1 shadow-lg glass ${
            MENU_PLACEMENT[placement] ?? MENU_PLACEMENT.bottom
          }`}
        >
          {actions.map(({ key, label, icon: Icon, onClick }) => (
            <button
              key={key}
              onClick={() => {
                setOpen(false);
                onClick();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-2 hover:bg-surface-2 press text-left"
            >
              {Icon && <Icon size={18} />}
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Sidebar fija en md+ (reemplaza header + tab bar inferior de móvil).
function Sidebar({ onLabels, menuActions }) {
  useLang();
  return (
    <aside className="hidden md:flex md:flex-col md:fixed md:inset-y-0 md:left-0 md:w-52 md:border-r md:border-border md:bg-surface md:py-4 md:px-3">
      <span className="font-display text-lg px-2 pb-4">
        nutri<span className="text-accent">.</span>
      </span>

      <nav className="flex flex-col gap-1 flex-1">
        {TABS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 min-h-[44px] px-3 rounded-lg transition-colors duration-150 ${
                isActive ? 'bg-surface-2 text-accent' : 'text-text-2'
              }`
            }
          >
            <Icon size={20} />
            <span className="text-sm">{t(label)}</span>
          </NavLink>
        ))}
      </nav>

      <div className="flex flex-col gap-1 pt-2 border-t border-border">
        <MoreOptions
          actions={menuActions}
          placement="right"
          label={t('Más opciones')}
          className="flex items-center gap-3 min-h-[44px] w-full px-3 rounded-lg text-text-2 transition-colors duration-150 hover:bg-surface-2"
        />
        <button
          onClick={onLabels}
          className="flex items-center gap-3 min-h-[44px] px-3 rounded-lg text-text-2 transition-colors duration-150 hover:bg-surface-2"
        >
          <Tags size={20} />
          <span className="text-sm">{t('Etiquetas')}</span>
        </button>
        <ThemeToggle
          showLabel
          className="flex items-center gap-3 min-h-[44px] w-full px-3 rounded-lg text-text-2 transition-colors duration-150 hover:bg-surface-2"
        />
        <LangToggle
          showLabel
          className="flex items-center gap-3 min-h-[44px] w-full px-3 rounded-lg text-text-2 transition-colors duration-150 hover:bg-surface-2"
        />
        <button
          onClick={() => supabase.auth.signOut()}
          className="flex items-center gap-3 min-h-[44px] px-3 rounded-lg text-text-2 transition-colors duration-150 hover:bg-surface-2"
        >
          <LogOut size={20} />
          <span className="text-sm">{t('Cerrar sesión')}</span>
        </button>
      </div>
    </aside>
  );
}

function Layout({ children }) {
  useLang();
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [menuActions, setMenuActions] = useState([]);
  const location = useLocation();
  const isDashboard = location.pathname === '/dashboard';

  useEffect(() => subscribeSectionMenu(setMenuActions), []);

  return (
    <div className="min-h-dvh flex flex-col md:flex-row">
      <Sidebar onLabels={() => setLabelsOpen(true)} menuActions={menuActions} />

      <div className="flex-1 flex flex-col min-w-0 md:ml-52">
        <header className="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-3 border-b border-border glass">
          <span className="font-display text-lg">
            nutri<span className="text-accent-glass">.</span>
          </span>
          <div className="flex items-center gap-1">
            <MoreOptions
              actions={menuActions}
              placement="bottom"
              className="p-2 rounded-lg press text-text-2"
            />
            <ThemeToggle className="p-2 rounded-lg press text-text-2" />
            <LangToggle className="p-2 rounded-lg press text-text-2" />
            <button
              onClick={() => setLabelsOpen(true)}
              className="p-2 rounded-lg press text-text-2"
              aria-label={t('Etiquetas')}
            >
              <Tags size={20} />
            </button>
            <button
              onClick={() => supabase.auth.signOut()}
              className="p-2 rounded-lg press text-text-2"
              aria-label={t('Cerrar sesión')}
            >
              <LogOut size={20} />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-x-clip pb-24 md:pb-8 md:pt-6">
          <div className={`mx-auto ${isDashboard ? 'max-w-3xl md:max-w-[1600px]' : 'max-w-3xl lg:max-w-6xl'}`}>{children}</div>
        </main>

        <nav
          className="md:hidden fixed bottom-0 inset-x-0 border-t border-border flex glass"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {TABS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              // El label activo usa --accent-glass, no --accent: sobre el glass puede
              // quedar una barra sólida del Dashboard (Cell fill=--d-prot) y ahí el
              // acento normal cae a 3.3:1.
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center gap-0.5 py-2 min-h-[44px] press ${
                  isActive ? 'text-accent-glass' : 'text-text-2'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={22} />
                  <span className="text-xs">{t(label)}</span>
                  {isActive && <span className="h-0.5 w-6 rounded-full bg-accent-glass" />}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>

      {labelsOpen && <LabelsModal onClose={() => setLabelsOpen(false)} />}
    </div>
  );
}

function RequireAuth({ session, children }) {
  if (session === undefined) return null;
  if (session === null) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  const session = useSession();

  useEffect(watchSystem, []);

  return (
    <Routes>
      <Route
        path="/login"
        element={session ? <Navigate to="/" replace /> : <Login />}
      />
      <Route
        path="/"
        element={
          <RequireAuth session={session}>
            <Today />
          </RequireAuth>
        }
      />
      <Route
        path="/foods"
        element={
          <RequireAuth session={session}>
            <Foods />
          </RequireAuth>
        }
      />
      <Route
        path="/recipes"
        element={
          <RequireAuth session={session}>
            <Recipes />
          </RequireAuth>
        }
      />
      <Route
        path="/targets"
        element={
          <RequireAuth session={session}>
            <Targets />
          </RequireAuth>
        }
      />
      <Route
        path="/dashboard"
        element={
          <RequireAuth session={session}>
            <Suspense fallback={<div className="px-4 py-8 text-center text-text-2">Cargando…</div>}>
              <Dashboard />
            </Suspense>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
