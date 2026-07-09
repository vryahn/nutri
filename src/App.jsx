import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom';
import { CalendarDays, Apple, ChefHat, Target, BarChart3, LogOut, Tags } from 'lucide-react';
import { supabase } from './lib/supabase.js';
import Login from './pages/Login.jsx';
import Today from './pages/Today.jsx';
import Foods from './pages/Foods.jsx';
import Recipes from './pages/Recipes.jsx';
import Targets from './pages/Targets.jsx';
import Dashboard from './pages/Dashboard.jsx';
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

  return session;
}

// Sidebar fija en md+ (reemplaza header + tab bar inferior de móvil).
function Sidebar({ onLabels }) {
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
            <span className="text-sm">{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="flex flex-col gap-1 pt-2 border-t border-border">
        <button
          onClick={onLabels}
          className="flex items-center gap-3 min-h-[44px] px-3 rounded-lg text-text-2 transition-colors duration-150 hover:bg-surface-2"
        >
          <Tags size={20} />
          <span className="text-sm">Etiquetas</span>
        </button>
        <button
          onClick={() => supabase.auth.signOut()}
          className="flex items-center gap-3 min-h-[44px] px-3 rounded-lg text-text-2 transition-colors duration-150 hover:bg-surface-2"
        >
          <LogOut size={20} />
          <span className="text-sm">Cerrar sesión</span>
        </button>
      </div>
    </aside>
  );
}

function Layout({ children }) {
  const [labelsOpen, setLabelsOpen] = useState(false);
  const location = useLocation();
  const isDashboard = location.pathname === '/dashboard';

  return (
    <div className="min-h-dvh flex flex-col md:flex-row">
      <Sidebar onLabels={() => setLabelsOpen(true)} />

      <div className="flex-1 flex flex-col min-w-0 md:ml-52">
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="font-display text-lg">
            nutri<span className="text-accent">.</span>
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setLabelsOpen(true)}
              className="p-2 rounded-lg press text-text-2"
              aria-label="Etiquetas"
            >
              <Tags size={20} />
            </button>
            <button
              onClick={() => supabase.auth.signOut()}
              className="p-2 rounded-lg press text-text-2"
              aria-label="Cerrar sesión"
            >
              <LogOut size={20} />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-x-clip pb-24 md:pb-8 md:pt-6">
          <div className={`mx-auto ${isDashboard ? 'max-w-3xl md:max-w-[1600px]' : 'max-w-3xl lg:max-w-6xl'}`}>{children}</div>
        </main>

        <nav
          className="md:hidden fixed bottom-0 inset-x-0 bg-surface border-t border-border flex"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {TABS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center gap-0.5 py-2 min-h-[44px] press ${
                  isActive ? 'text-accent' : 'text-text-2'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={22} />
                  <span className="text-xs">{label}</span>
                  {isActive && <span className="h-0.5 w-6 rounded-full bg-accent" />}
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
            <Dashboard />
          </RequireAuth>
        }
      />
    </Routes>
  );
}
