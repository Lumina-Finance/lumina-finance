import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'motion/react'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { useTheme } from '@/hooks/useTheme'
import Navigation from '@/components/Navigation'
import Dashboard from '@/components/Dashboard'
import Auth from '@/pages/Auth'

/** Redirect to /login if unauthenticated */
function ProtectedRoute() {
  const { user, loading } = useAuth();

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div
      className="flex min-h-screen"
      style={{ backgroundColor: 'var(--app-bg)', color: 'var(--app-text)' }}
    >
      <Navigation />
      <main className="flex-1 px-5 pb-8 pt-6 lg:px-8 lg:pb-12 lg:pt-12">
        <Outlet />
      </main>
    </div>
  );
}

/** Redirect to / if already authenticated */
function PublicRoute() {
  const { user, loading } = useAuth();

  if (loading) return null;
  if (user) return <Navigate to="/" replace />;

  return <Outlet />;
}

function PageTitle({ title }: { title: string }) {
  return (
    <h1 className="font-serif text-4xl font-light tracking-tight">
      {title}
    </h1>
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
          <Route path="/accounts" element={<PageTitle title="Accounts" />} />
          <Route path="/transactions" element={<PageTitle title="Transactions" />} />
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
