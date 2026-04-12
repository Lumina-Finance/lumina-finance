import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'motion/react'
import { AuthProvider } from '@/contexts/AuthContext'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import Navigation from '@/components/Navigation'
import Dashboard from '@/components/Dashboard'
import Accounts from '@/components/Accounts'
import LoadingScreen from '@/components/LoadingScreen'
import Auth from '@/pages/Auth'

const LOADING_SCREEN_MIN_MS = 1000;

// Module-level flag so the loading screen only shows once per app session
let hasShownLoadingScreen = false;

/** Redirect to /login if unauthenticated. Show loading screen on first visit. */
function ProtectedRoute() {
  const { user, loading } = useAuth();
  // Only show loading screen if there's a session being restored or user just authenticated
  const shouldShowLoading = loading || (!hasShownLoadingScreen && user);
  const [minTimePassed, setMinTimePassed] = useState(hasShownLoadingScreen);

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
          <main className="flex-1 px-5 pb-8 pt-6 lg:px-8 lg:pb-12 lg:pt-12">
            <Outlet />
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

function PageTitle({ title, description }: { title: string; description?: string }) {
  return (
    <header className="app-page-header">
      <h1 className="app-page-title">{title}</h1>
      {description && <p className="app-page-description">{description}</p>}
    </header>
  )
}

function AnimatedRoutes() {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname === '/signup' ? '/login' : location.pathname}>
        {/* Public routes — login, signup */}
        <Route element={<PublicRoute />}>
          <Route path="/login" element={<Auth />} />
          <Route path="/signup" element={<Auth />} />
        </Route>

        {/* Protected routes — app shell with sidebar */}
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/transactions" element={<PageTitle title="Transactions" description="Every transaction, all in one place." />} />
          <Route path="/budgets" element={<PageTitle title="Budgets" />} />
          <Route path="/insights" element={<PageTitle title="Insights" />} />
          <Route path="/settings" element={<PageTitle title="Settings" />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AnimatePresence>
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
