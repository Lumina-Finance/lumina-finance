import { useState, useEffect, useLayoutEffect } from 'react'
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
const PAGE_TRANSITION_MS = 350;
const PAGE_TRANSITION_OFFSET_PX = 12;

type PageTransitionPhase = 'idle' | 'exiting' | 'entering';

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
function ProtectedRoute({ pageTransitionPhase }: { pageTransitionPhase: PageTransitionPhase }) {
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
                y: pageTransitionPhase === 'exiting' ? -pageTransitionOffset : 0,
              }}
              transition={{
                duration: PAGE_TRANSITION_MS / 1000,
                ease: 'easeInOut',
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
  const [displayLocation, setDisplayLocation] = useState(location);
  const [pageTransitionPhase, setPageTransitionPhase] = useState<PageTransitionPhase>('idle');

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
      if (!isProtectedPath(location.pathname) || !isProtectedPath(displayLocation.pathname)) {
        setDisplayLocation(location);
        setPageTransitionPhase('idle');
        return;
      }

      setPageTransitionPhase('exiting');

      exitTimer = window.setTimeout(() => {
        setDisplayLocation(location);
        setPageTransitionPhase('entering');
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
