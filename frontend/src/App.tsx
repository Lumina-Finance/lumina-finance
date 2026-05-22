import { useState, useEffect, useRef } from 'react'
import { useIsFetching } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { AuthProvider } from '@/contexts/AuthContext'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import Navigation from '@/components/Navigation'
import DashboardPage from '@/dashboard/DashboardPage'
import AccountsPage from '@/accounts/AccountsPage'
import AccountDetailPage from '@/accounts/detail/AccountDetailPage'
import TransactionsPage from '@/transactions/TransactionsPage'
import BudgetsPage from '@/budgets/BudgetsPage'
import InsightsPage from '@/insights/InsightsPage'
import SettingsPage from '@/settings/SettingsPage'
import ImportsPage from '@/imports/ImportsPage'
import LoadingScreen from '@/components/LoadingScreen'
import Auth from '@/pages/Auth'

const LOADING_SCREEN_MIN_MS = 1000;
const PAGE_TRANSITION_EXIT_MS = 180;
const PAGE_TRANSITION_MIN_LOADING_MS = 800;
const PAGE_TRANSITION_ENTER_MS = 260;

type PageTransitionPhase = 'idle' | 'exiting' | 'loading' | 'entering';

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

// Module-level flag so the loading screen only shows once per app session
let hasShownLoadingScreen = false;

/** Redirect to /login if unauthenticated. Show loading screen on first visit. */
function ProtectedRoute({ pageTransitionPhase }: { pageTransitionPhase: PageTransitionPhase }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const pageTransitioning = pageTransitionPhase !== 'idle';
  const pageContentVisible = pageTransitionPhase === 'idle' || pageTransitionPhase === 'entering';
  const isFocusedPage = location.pathname === '/settings/imports';
  // Only show loading screen if there's a session being restored or user just authenticated
  const shouldShowLoading = loading || (!hasShownLoadingScreen && user);
  const [minTimePassed, setMinTimePassed] = useState(hasShownLoadingScreen);

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

  const ready = !loading && minTimePassed;

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
          <main
            id="app-page-content"
            className={`min-w-0 flex-1 ${isFocusedPage ? 'fixed inset-0 z-[60] p-0' : 'relative px-4 pb-8 pt-6 min-[1050px]:ml-[260px] min-[1050px]:px-6 min-[1050px]:pb-12 min-[1050px]:pt-12'}`}
            aria-busy={pageTransitioning}
          >
            <AnimatePresence>
              {pageTransitionPhase === 'loading' && (
                <LoadingScreen variant={isFocusedPage ? 'screen' : 'main'} />
              )}
            </AnimatePresence>
            <motion.div
              initial={false}
              animate={{ opacity: pageContentVisible ? 1 : 0 }}
              transition={{
                duration: (pageTransitionPhase === 'exiting' ? PAGE_TRANSITION_EXIT_MS : PAGE_TRANSITION_ENTER_MS) / 1000,
                ease: 'easeOut',
              }}
              style={{ pointerEvents: pageContentVisible ? 'auto' : 'none' }}
            >
              <Outlet />
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

  return <Outlet />;
}

function AnimatedRoutes() {
  const location = useLocation();
  const fetchingCount = useIsFetching();
  const [displayLocation, setDisplayLocation] = useState(location);
  const [pageTransitionPhase, setPageTransitionPhase] = useState<PageTransitionPhase>('idle');
  const loadingStartedAtRef = useRef<number | null>(null);

  // Keep rendering the previous protected route until its exit fade completes.
  useEffect(() => {
    if (location.pathname === displayLocation.pathname) return;

    if (!isProtectedPath(location.pathname) || !isProtectedPath(displayLocation.pathname)) {
      setDisplayLocation(location);
      setPageTransitionPhase('idle');
      return;
    }

    setPageTransitionPhase('exiting');

    const timer = window.setTimeout(() => {
      setDisplayLocation(location);
      loadingStartedAtRef.current = null;
      setPageTransitionPhase('loading');
    }, PAGE_TRANSITION_EXIT_MS);

    return () => window.clearTimeout(timer);
  }, [displayLocation.pathname, location]);

  // Hold the route-level loading state until queries settle and the minimum
  // transition duration has elapsed.
  useEffect(() => {
    if (pageTransitionPhase !== 'loading') return;

    loadingStartedAtRef.current ??= performance.now();

    if (fetchingCount > 0) return;

    const elapsed = performance.now() - loadingStartedAtRef.current;
    const remaining = Math.max(0, PAGE_TRANSITION_MIN_LOADING_MS - elapsed);
    const timer = window.setTimeout(() => {
      setPageTransitionPhase('entering');
    }, remaining);

    return () => window.clearTimeout(timer);
  }, [fetchingCount, pageTransitionPhase]);

  // Finish the enter phase after the content fade-in completes.
  useEffect(() => {
    if (pageTransitionPhase !== 'entering') return;

    const timer = window.setTimeout(() => {
      setPageTransitionPhase('idle');
    }, PAGE_TRANSITION_ENTER_MS);

    return () => window.clearTimeout(timer);
  }, [pageTransitionPhase]);

  return (
    <Routes
      location={displayLocation}
      key={displayLocation.pathname === '/signup' ? '/login' : displayLocation.pathname}
    >
        {/* Public routes — login, signup */}
        <Route element={<PublicRoute />}>
          <Route path="/login" element={<Auth />} />
          <Route path="/signup" element={<Auth />} />
        </Route>

        {/* Protected app routes */}
        <Route element={<ProtectedRoute pageTransitionPhase={pageTransitionPhase} />}>
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
