import { NavLink } from 'react-router-dom';
import {
  BarChart2,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Moon,
  Monitor,
  PieChart,
  Receipt,
  Settings,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import type { Theme } from '@/types';

interface NavigationItem {
  to: string;
  icon: LucideIcon;
  label: string;
}

const navItems: NavigationItem[] = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/accounts', icon: CreditCard, label: 'Accounts' },
  { to: '/transactions', icon: Receipt, label: 'Transactions' },
  { to: '/budgets', icon: PieChart, label: 'Budgets' },
  { to: '/insights', icon: BarChart2, label: 'Insights' },
];

const Navigation = () => {
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();

  // Display name and avatar initials from the authenticated user. Falls back to
  // sensible placeholders so the nav renders even during the split-second before
  // user state hydrates from the refresh flow.
  const displayName = user
    ? `${user.first_name}${user.last_name ? ` ${user.last_name}` : ''}`
    : '';
  const initials = user
    ? `${user.first_name[0] ?? ''}${user.last_name?.[0] ?? ''}`.toUpperCase()
    : '';

  return (
    <nav
      aria-label="Primary"
      className="sticky top-5 flex flex-col h-[calc(100vh-2.5rem)] w-60 shrink-0 rounded-2xl px-4 py-7 m-5 mr-0"
      style={{
        background: 'var(--app-nav-bg)',
        border: '1px solid var(--app-border)',
        boxShadow: 'var(--app-shadow-soft)',
      }}
    >
      {/* Logo and subtitle */}
      <div className="mb-8 px-2">
        <h1 className="font-serif text-[1.85rem] font-medium leading-none tracking-[-0.02em]">
          Lumina
        </h1>
        <p
          className="mt-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.24em]"
          style={{ color: 'var(--app-accent)' }}
        >
          Finance
        </p>
      </div>

      <ul className="list-none space-y-1 p-0 m-0">
        {[...navItems, { to: '/settings', icon: Settings, label: 'Settings' }].map((item) => {
          const Icon = item.icon;
          const isSettings = item.to === '/settings';
          return (
            <li key={item.label}>
              {isSettings && (
                <div aria-hidden className="mx-2 my-3 h-px" style={{ background: 'var(--app-border)' }} />
              )}
              <NavLink
                to={item.to}
                end
                className={({ isActive }) =>
                  `app-nav-link ${isActive ? 'app-nav-link-active' : ''}`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon size={17} strokeWidth={isActive ? 2 : 1.75} className="shrink-0" aria-hidden />
                    {item.label}
                  </>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>

      {/* Theme toggle */}
      <div className="mt-auto pt-4">
        <div
          className="flex items-center gap-1 rounded-xl p-1"
          style={{ background: 'var(--app-surface-soft)', border: '1px solid var(--app-border)' }}
          role="group"
          aria-label="Theme selection"
        >
          {([
            { value: 'light' as Theme, icon: Sun, label: 'Light theme' },
            { value: 'system' as Theme, icon: Monitor, label: 'System theme' },
            { value: 'dark' as Theme, icon: Moon, label: 'Dark theme' },
          ]).map(({ value, icon: Icon, label }) => {
            const isActive = theme === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setTheme(value)}
                aria-pressed={isActive}
                aria-label={label}
                className={`app-nav-link flex-1 justify-center ${isActive ? 'app-nav-link-active' : ''}`}
              >
                <Icon size={16} strokeWidth={isActive ? 2.25 : 2} aria-hidden />
              </button>
            );
          })}
        </div>
      </div>

      {/* User profile */}
      <div className="pt-3">
        <div
          className="app-nav-link"
          style={{ background: 'var(--app-surface-soft)', border: '1px solid var(--app-border)' }}
        >
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
            style={{
              background: 'linear-gradient(135deg, #C9A96A 0%, #9B6C2C 100%)',
              color: '#1C1510',
            }}
          >
            {initials}
          </div>
          <div className="min-w-0 flex-1 overflow-hidden">
            <p className="truncate text-sm font-medium" style={{ color: 'var(--app-text)' }}>
              {displayName}
            </p>
            <p className="truncate text-[0.6875rem]" style={{ color: 'var(--app-text-subtle)' }}>
              Premium Plan
            </p>
          </div>
          <button
            type="button"
            onClick={() => { void logout(); }}
            aria-label="Log out"
            className="shrink-0 rounded-md p-1 transition-colors duration-150 hover:bg-[var(--app-accent-soft)]"
            style={{ color: 'var(--app-text-subtle)' }}
          >
            <LogOut size={14} aria-hidden />
          </button>
        </div>
      </div>
    </nav>
  );
};

export default Navigation;
