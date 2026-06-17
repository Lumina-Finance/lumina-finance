import { useState, useEffect, useLayoutEffect, useCallback, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { AuthProvider } from '@/contexts/AuthContext'
import { useAuth } from '@/hooks/useAuth'
import { useCacheValidation } from '@/hooks/useCacheValidation'
import { useTheme } from '@/hooks/useTheme'
import Navigation from '@/components/navigation/Navigation'
import LoadingScreen from '@/components/loading/Screen'

// Pages are lazy-loaded so each route ships as its own chunk instead of the
// initial bundle, keeping first load small and pulling heavy page-only deps
// like recharts off the landing path
const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage'))
const AccountsPage = lazy(() => import('@/pages/accounts/AccountsPage'))
const AccountDetailPage = lazy(() => import('@/pages/accounts/detail/AccountDetailPage'))
const TransactionsPage = lazy(() => import('@/pages/transactions/TransactionsPage'))
const BudgetsPage = lazy(() => import('@/pages/budgets/BudgetsPage'))
const InsightsPage = lazy(() => import('@/pages/insights/InsightsPage'))
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'))
const ImportsPage = lazy(() => import('@/pages/imports/ImportsPage'))
const AuthPage = lazy(() => import('@/pages/auth/AuthPage'))

const LOADING_SCREEN_MIN_MS = 1000;
const PAGE_TRANSITION_MS = 350;
const PAGE_TRANSITION_OFFSET_PX = 12;
const ROUTE_LOADER_DELAY_MS = 300;

type PageTransitionPhase = 'idle' | 'exiting' | 'loading' | 'entering';

/**
 * Reports the displayed route once its lazy chunk has resolved and mounted so the
 * route loader can fade out under AnimatePresence rather than being unmounted
 * instantly the way a Suspense fallback would be
 */
function RouteReadyNotifier({ path, onReady }: { path: string; onReady: () => void }) {
  useEffect(() => {
    onReady();
  }, [path, onReady]);

  return null;
}

function isProtectedPath(pathname: string) {
  return (
    pathname === '/' ||
    pathname.startsWith('/accounts') ||
    pathname === '/transactions' ||
    pathname === '/budgets' ||
    pathname === '/insights' ||
    pathname.startsWith('/settings')
  );
}

function isBudgetDetailRoute(pathname: string, search: string) {
  return pathname === '/budgets' && new URLSearchParams(search).has('budget');
}

function scrollDocumentToTop() {
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
}

// Module-level flag so the loading screen only shows once per app session
let hasShownLoadingScreen = false;

/** Redirect to /login if unauthenticated. Show loading screen on first visit. */
function ProtectedRoute({ displayPath, onContentReady, pageTransitionPhase }: { displayPath: string; onContentReady: () => void; pageTransitionPhase: PageTransitionPhase }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const pageTransitioning = pageTransitionPhase !== 'idle';
  const pageContentVisible = pageTransitionPhase === 'idle' || pageTransitionPhase === 'entering';
  const isFocusedPage = location.pathname === '/settings/imports';
  const desktopBottomPadding = location.pathname === '/transactions' ? 'min-[1050px]:pb-12' : 'min-[1050px]:pb-5';
  const pageTransitionOffset = isBudgetDetailRoute(location.pathname, location.search) ? 0 : PAGE_TRANSITION_OFFSET_PX;
  // Only show loading screen if there's a session being restored or user just authenticated
  const shouldShowLoading = loading || (!hasShownLoadingScreen && user);
  const [minTimePassed, setMinTimePassed] = useState(hasShownLoadingScreen);
  const [animateInitialPageMount] = useState(() => !hasShownLoadingScreen);
  const ready = !loading && minTimePassed;

  // The loading phase runs after the switch while the new route's chunk mounts
  const routeLoading = pageTransitionPhase === 'loading';
  const [routeLoaderDelayElapsed, setRouteLoaderDelayElapsed] = useState(false);

  useCacheValidation(user?.id, Boolean(user && ready));

  // Hold the route loader back until the chunk has stayed pending past the delay so
  // cached or fast navigations never flash the spinner, and clear the flag on
  // teardown so the next navigation starts its own delay from scratch
  useEffect(() => {
    if (!ready || !routeLoading) return;
    const timer = setTimeout(() => setRouteLoaderDelayElapsed(true), ROUTE_LOADER_DELAY_MS);
    return () => {
      clearTimeout(timer);
      setRouteLoaderDelayElapsed(false);
    };
  }, [ready, routeLoading]);

  // Enforce the first-session loading-screen minimum before revealing the app.
  useEffect(() => {
    if (hasShownLoadingScreen || !shouldShowLoading) return;
    const timer = setTimeout(() => {
      hasShownLoadingScreen = true;
      setMinTimePassed(true);
    }, LOADING_SCREEN_MIN_MS);
    return () => clearTimeout(timer);
  }, [shouldShowLoading]);

  // No session and not loading — go straight to login
  if (!loading && !user) return <Navigate to="/login" replace />;

  const pageContentEntering = pageTransitionPhase === 'entering' || animateInitialPageMount;

  return (
    <>
      <AnimatePresence>
        {!ready && <LoadingScreen />}
      </AnimatePresence>
      {ready && (
        <div
          className="flex min-h-screen"
          style={{ backgroundColor: 'var(--app-bg)', color: 'var(--app-text)' }}
        >
          <Navigation />

          {/* The main variant keeps the navigation visible while AnimatePresence
              lets the loader fade back out once the route chunk has mounted */}
          <AnimatePresence>
            {routeLoading && routeLoaderDelayElapsed && <LoadingScreen key="route-loader" variant="main" />}
          </AnimatePresence>
          <main
            id="app-page-content"
            className={`min-w-0 flex-1 ${isFocusedPage ? 'fixed inset-0 z-[60] p-0' : `relative px-4 pb-8 pt-6 min-[1050px]:ml-[260px] min-[1050px]:px-6 ${desktopBottomPadding} min-[1050px]:pt-10`}`}
            aria-busy={pageTransitioning}
          >
            <motion.div
              initial={{
                opacity: pageContentEntering ? 0 : 1,
                y: pageContentEntering ? pageTransitionOffset : 0,
              }}
              animate={{
                opacity: pageContentVisible ? 1 : 0,
                y: pageTransitionPhase === 'exiting'
                  ? -pageTransitionOffset
                  : pageTransitionPhase === 'loading'
                    ? pageTransitionOffset
                    : 0,
              }}
              transition={{
                duration: PAGE_TRANSITION_MS / 1000,
                ease: 'easeInOut',
              }}
              style={{ pointerEvents: pageContentVisible ? 'auto' : 'none' }}
            >
              <Suspense fallback={null}>
                <RouteReadyNotifier path={displayPath} onReady={onContentReady} />
                <Outlet />
              </Suspense>
            </motion.div>
          </main>
        </div>
      )}
    </>
  );
}

/** Redirect to / if already authenticated */
function PublicRoute() {
  const { user, loading } = useAuth();

  if (loading) return null;
  if (user) return <Navigate to="/" replace />;

  return (
    <Suspense fallback={null}>
      <Outlet />
    </Suspense>
  );
}

function AnimatedRoutes() {
  const location = useLocation();
  const [displayLocation, setDisplayLocation] = useState(location);
  const [pageTransitionPhase, setPageTransitionPhase] = useState<PageTransitionPhase>('idle');

  // Reveal the freshly switched route only once its chunk has mounted, so the enter
  // fade animates real content rather than an empty wrapper. The functional updater
  // reads the current phase so a late notifier from an abandoned navigation is ignored
  const handleContentReady = useCallback(() => {
    setPageTransitionPhase((current) => (current === 'loading' ? 'entering' : current));
  }, []);

  useLayoutEffect(() => {
    scrollDocumentToTop();
  }, [displayLocation.pathname]);

  // Keep rendering the previous protected route until its exit fade completes.
  useEffect(() => {
    if (location.pathname === displayLocation.pathname) {
      if (location.search !== displayLocation.search || location.hash !== displayLocation.hash) {
        const syncTimer = window.setTimeout(() => {
          setDisplayLocation(location);
        }, 0);

        return () => window.clearTimeout(syncTimer);
      }
      return;
    }

    let exitTimer: number | undefined;

    const transitionTimer = window.setTimeout(() => {
      const nextPathIsProtected = isProtectedPath(location.pathname);
      const displayedPathIsProtected = isProtectedPath(displayLocation.pathname);

      if (!nextPathIsProtected || !displayedPathIsProtected) {
        setDisplayLocation(location);
        setPageTransitionPhase(nextPathIsProtected ? 'loading' : 'idle');
        return;
      }

      setPageTransitionPhase('exiting');

      exitTimer = window.setTimeout(() => {
        setDisplayLocation(location);
        setPageTransitionPhase('loading');
      }, PAGE_TRANSITION_MS);
    }, 0);

    return () => {
      window.clearTimeout(transitionTimer);
      if (exitTimer !== undefined) window.clearTimeout(exitTimer);
    };
  }, [displayLocation.hash, displayLocation.pathname, displayLocation.search, location]);

  // Finish the enter phase after the content fade-in completes.
  useEffect(() => {
    if (pageTransitionPhase !== 'entering') return;

    const timer = window.setTimeout(() => {
      setPageTransitionPhase('idle');
    }, PAGE_TRANSITION_MS);

    return () => window.clearTimeout(timer);
  }, [pageTransitionPhase]);

  return (
    <Routes
      location={displayLocation}
      key={displayLocation.pathname === '/signup' ? '/login' : displayLocation.pathname}
    >
        {/* Public routes — login, signup */}
        <Route element={<PublicRoute />}>
          <Route path="/login" element={<AuthPage />} />
          <Route path="/signup" element={<AuthPage />} />
        </Route>

        {/* Protected app routes */}
        <Route element={<ProtectedRoute displayPath={displayLocation.pathname} onContentReady={handleContentReady} pageTransitionPhase={pageTransitionPhase} />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/accounts/:accountId" element={<AccountDetailPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/budgets" element={<BudgetsPage />} />
          <Route path="/insights" element={<InsightsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/imports" element={<ImportsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function AppShell() {
  useTheme();
  return <AnimatedRoutes />;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
