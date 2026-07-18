import { useEffect, useState, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom';
import { CalendarDays, Apple, ChefHat, Target, BarChart3, Ruler, MoreHorizontal } from 'lucide-react';
import { supabase } from './lib/supabase.js';
import { cacheClear } from './lib/cache.js';
import { subscribeSectionMenu } from './lib/sectionMenu.js';
import { useOutsideClose } from './lib/useOutsideClose.js';
import { watchSystem } from './lib/theme.js';
import { t, useLang, registerLangUser, registerUnitsUser, registerProfile, registerAdherenceBands, registerSleepThreshold } from './lib/i18n.js';
import PageSkeleton from './components/PageSkeleton.jsx';
import UserMenu from './components/UserMenu.jsx';
import Login from './pages/Login.jsx';
import Today from './pages/Today.jsx';

// Today stays eager (main route); the rest is only downloaded when its tab is opened.
const Foods = lazy(() => import('./pages/Foods.jsx'));
const Recipes = lazy(() => import('./pages/Recipes.jsx'));
const Targets = lazy(() => import('./pages/Targets.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Body = lazy(() => import('./pages/Body.jsx'));
const OAuthConsent = lazy(() => import('./pages/OAuthConsent.jsx'));

const PageFallback = <PageSkeleton />;

const TABS = [
  { to: '/', label: 'Hoy', icon: CalendarDays, end: true },
  { to: '/foods', label: 'Alimentos', icon: Apple },
  { to: '/recipes', label: 'Recetas', icon: ChefHat },
  { to: '/targets', label: 'Objetivos', icon: Target },
  { to: '/dashboard', label: 'Dashboard', icon: BarChart3 },
  { to: '/body', label: 'Medidas', icon: Ruler },
];

function useSession() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) cacheClear(); // the session cache must not survive a signout
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Registers the user to persist language and units in prefs (cross-device)
  // and applies prefs.data.{lang,units} if they differ from what localStorage detected.
  useEffect(() => {
    if (!session) return;
    supabase.from('prefs').select('data').maybeSingle().then(({ data }) => {
      registerLangUser(session.user.id, data?.data?.lang);
      registerUnitsUser(data?.data?.units);
      registerProfile(data?.data?.profile);
      registerAdherenceBands(data?.data?.adherence_bands);
      registerSleepThreshold(data?.data?.sueno_umbral_h);
    });
  }, [session]);

  return session;
}

// "Más opciones": dynamic button that nests the actions published by the active
// page (setSectionMenu). With no actions it does not render. `placement` decides
// whether the menu opens downward (mobile header) or to the right (sidebar, at the bottom).
// In both cases it floats over the content, so it carries `.glass`; opening it
// upward left it inside the sidebar, with nothing behind it to blur.
// Close on outside tap: `useOutsideClose`, not a backdrop (the header is .glass).
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

// Fixed sidebar on md+ (replaces the mobile header + bottom tab bar).
function Sidebar({ menuActions }) {
  useLang();
  return (
    <aside className="hidden md:flex md:flex-col md:fixed md:inset-y-0 md:left-0 md:w-52 md:z-40 md:border-r md:border-border md:bg-surface md:py-4 md:px-3">
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
        <UserMenu
          placement="right"
          showLabel
          className="flex items-center gap-3 min-h-[44px] w-full px-3 rounded-lg text-text-2 transition-colors duration-150 hover:bg-surface-2"
        />
      </div>
    </aside>
  );
}

function Layout({ children }) {
  useLang();
  const [menuActions, setMenuActions] = useState([]);
  const location = useLocation();
  const isDashboard = location.pathname === '/dashboard';

  useEffect(() => subscribeSectionMenu(setMenuActions), []);

  return (
    <div className="min-h-dvh flex flex-col md:flex-row">
      <Sidebar menuActions={menuActions} />

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
            <UserMenu placement="bottom" className="p-1 rounded-full press" />
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
              // The active label uses --accent-glass, not --accent: a solid Dashboard
              // bar (Cell fill=--d-prot) may end up under the glass, and there the
              // normal accent drops to 3.3:1.
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
    </div>
  );
}

// Routes outside the tab bar (e.g. /oauth/consent) do not get Layout: they are
// single-screen, with no nav. The caller decides `withLayout` based on the route.
function RequireAuth({ session, children, withLayout = true }) {
  const location = useLocation();
  if (session === undefined) return null;
  if (session === null) return <Navigate to="/login" state={{ from: `${location.pathname}${location.search}` }} replace />;
  return withLayout ? <Layout>{children}</Layout> : children;
}

export default function App() {
  const session = useSession();
  const location = useLocation();
  const loginRedirect = location.state?.from || '/';

  useEffect(watchSystem, []);

  // Preloads the lazy chunks of the other tabs at idle: the first section switch
  // does not wait for the bundle download (only for the fetch of its data).
  useEffect(() => {
    if (!session) return;
    const warm = () => {
      import('./pages/Foods.jsx');
      import('./pages/Recipes.jsx');
      import('./pages/Targets.jsx');
      import('./pages/Dashboard.jsx');
      import('./pages/Body.jsx');
    };
    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(warm);
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(warm, 1500);
    return () => clearTimeout(id);
  }, [session]);

  return (
    <Routes>
      <Route
        path="/login"
        element={session ? <Navigate to={loginRedirect} replace /> : <Login />}
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
            <Suspense fallback={PageFallback}>
              <Foods />
            </Suspense>
          </RequireAuth>
        }
      />
      <Route
        path="/recipes"
        element={
          <RequireAuth session={session}>
            <Suspense fallback={PageFallback}>
              <Recipes />
            </Suspense>
          </RequireAuth>
        }
      />
      <Route
        path="/targets"
        element={
          <RequireAuth session={session}>
            <Suspense fallback={PageFallback}>
              <Targets />
            </Suspense>
          </RequireAuth>
        }
      />
      <Route
        path="/dashboard"
        element={
          <RequireAuth session={session}>
            <Suspense fallback={PageFallback}>
              <Dashboard />
            </Suspense>
          </RequireAuth>
        }
      />
      <Route
        path="/body"
        element={
          <RequireAuth session={session}>
            <Suspense fallback={PageFallback}>
              <Body />
            </Suspense>
          </RequireAuth>
        }
      />
      <Route
        path="/oauth/consent"
        element={
          <RequireAuth session={session} withLayout={false}>
            <Suspense fallback={PageFallback}>
              <OAuthConsent />
            </Suspense>
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
