import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowUpRight,
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
import { CURRENT_APP_VERSION, fetchAppVersion, type AppUpdateNotice } from '@/api/version';
import { useAuth } from '@/hooks/useAuth';
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

const primaryNavItems = [...navItems, { to: '/settings', icon: Settings, label: 'Settings' }];

const mobileMenuFadeMs = 260;

function NavigationBrand() {
  return (
    <div className="flex items-center gap-1">
      <img
        src="/logo.png"
        alt=""
        aria-hidden="true"
        className="-ml-1.5 h-[3.75rem] w-[3.75rem] shrink-0 object-contain"
      />
      <div className="min-w-0">
        <h1 className="font-serif text-[1.85rem] font-medium leading-none tracking-normal">
          Lumina
        </h1>
        <p
          className="ml-0.5 mt-0.5 text-[0.6875rem] font-semibold uppercase tracking-[0.24em]"
          style={{ color: 'var(--app-accent)' }}
        >
          Finance
        </p>
      </div>
    </div>
  );
}

function NavigationLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <ul className="list-none space-y-1 p-0 m-0">
      {primaryNavItems.map((item) => {
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
              onClick={onNavigate}
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
  );
}

function ThemeToggle({
  theme,
  setTheme,
  onThemeChange,
}: {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  onThemeChange?: () => void;
}) {
  return (
    <div
      className="app-segmented-control w-full"
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
            onClick={() => {
              if (value === theme) return;
              setTheme(value);
              onThemeChange?.();
            }}
            aria-pressed={isActive}
            aria-label={label}
            className={`app-segmented-option flex-1 px-0 ${isActive ? 'app-segmented-option-active' : ''}`}
          >
            <Icon size={16} strokeWidth={isActive ? 2.25 : 2} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

function UserProfile({
  displayName,
  initials,
  logout,
}: {
  displayName: string;
  initials: string;
  logout: () => Promise<void>;
}) {
  return (
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
        className="app-icon-button shrink-0"
      >
        <LogOut size={14} aria-hidden />
      </button>
    </div>
  );
}

function formatVersionLabel(version: string) {
  const trimmedVersion = version.trim();
  return trimmedVersion.toLowerCase().startsWith('v') ? trimmedVersion : `v${trimmedVersion}`;
}

function getCurrentVersionLabel(version: string) {
  const trimmedVersion = version.trim();
  return trimmedVersion ? `Lumina Finance ${formatVersionLabel(trimmedVersion)}` : 'Lumina Finance';
}

function VersionIndicator() {
  const [version, setVersion] = useState(CURRENT_APP_VERSION);
  const [updateNotice, setUpdateNotice] = useState<AppUpdateNotice | null>(null);
  const currentVersionLabel = getCurrentVersionLabel(version);

  useEffect(() => {
    let isMounted = true;

    fetchAppVersion()
      .then((appVersion) => {
        if (!isMounted) return;
        setVersion(appVersion.version.trim() || CURRENT_APP_VERSION);
        setUpdateNotice(appVersion.update);
      })
      .catch(() => undefined);

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="mt-2 px-2 text-center" aria-label={currentVersionLabel}>
      <p className="m-0 truncate text-center text-xs font-normal" style={{ color: 'var(--app-text-subtle)' }}>
        {currentVersionLabel}
      </p>
      {updateNotice && (
        <a
          href={updateNotice.releaseUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 flex min-h-5 items-center justify-center gap-1.5 text-[0.6875rem] font-medium no-underline transition-opacity duration-150 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent-soft)] motion-reduce:transition-none"
          style={{ color: 'var(--app-accent)' }}
        >
          <span className="relative flex h-3 w-3 shrink-0 items-center justify-center" aria-hidden>
            <span
              className="absolute inline-flex h-3 w-3 animate-ping rounded-full opacity-40 motion-reduce:animate-none"
              style={{ background: 'var(--app-accent)' }}
            />
            <span
              className="relative inline-flex h-2.5 w-2.5 rounded-full"
              style={{ background: 'var(--app-accent)' }}
            />
          </span>
          <span className="min-w-0 truncate">New version available</span>
          <ArrowUpRight size={12} strokeWidth={2.25} className="shrink-0" aria-hidden />
        </a>
      )}
    </div>
  );
}

function AnimatedMobileMenuIcon({
  isOpen,
  shouldReduceMotion,
}: {
  isOpen: boolean;
  shouldReduceMotion: boolean | null;
}) {
  const transition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: 0.24, ease: 'easeOut' as const };

  return (
    <span className="relative block h-5 w-5" aria-hidden>
      <motion.span
        className="absolute left-1/2 top-1/2 h-0.5 w-5 rounded-full"
        style={{ background: 'currentColor', transformOrigin: 'center' }}
        initial={false}
        animate={isOpen ? { x: '-50%', y: '-50%', rotate: 45 } : { x: '-50%', y: '-0.5rem', rotate: 0 }}
        transition={transition}
      />
      <motion.span
        className="absolute left-1/2 top-1/2 h-0.5 w-5 rounded-full"
        style={{ background: 'currentColor', transformOrigin: 'center' }}
        initial={false}
        animate={
          isOpen
            ? { x: '-50%', y: '-50%', opacity: 0, scaleX: 0.35 }
            : { x: '-50%', y: '-50%', opacity: 1, scaleX: 1 }
        }
        transition={transition}
      />
      <motion.span
        className="absolute left-1/2 top-1/2 h-0.5 w-5 rounded-full"
        style={{ background: 'currentColor', transformOrigin: 'center' }}
        initial={false}
        animate={isOpen ? { x: '-50%', y: '-50%', rotate: -45 } : { x: '-50%', y: '0.375rem', rotate: 0 }}
        transition={transition}
      />
    </span>
  );
}

function DesktopNavigation({
  theme,
  setTheme,
  displayName,
  initials,
  logout,
}: {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  displayName: string;
  initials: string;
  logout: () => Promise<void>;
}) {
  return (
    <nav
      aria-label="Primary"
      className="app-desktop-nav fixed left-5 z-30 hidden w-60 flex-col rounded-2xl px-4 pb-4 pt-7 min-[1050px]:flex"
      style={{
        background: 'var(--app-nav-bg)',
        border: '1px solid var(--app-border)',
        boxShadow: 'var(--app-shadow-soft)',
      }}
    >
      <div className="mb-8">
        <NavigationBrand />
      </div>

      <NavigationLinks />

      <div className="mt-auto pt-4">
        <ThemeToggle theme={theme} setTheme={setTheme} />
      </div>

      <div className="pt-3">
        <UserProfile displayName={displayName} initials={initials} logout={logout} />
      </div>

      <VersionIndicator />
    </nav>
  );
}

function MobileNavigation({
  theme,
  setTheme,
  displayName,
  initials,
  logout,
}: {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  displayName: string;
  initials: string;
  logout: () => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    if (!isOpen) return;

    const root = document.documentElement;
    const navBackground = getComputedStyle(root).getPropertyValue('--app-nav-bg').trim() || '#F8F4EC';
    const previousOverflow = document.body.style.overflow;
    const previousRootOverflow = root.style.overflow;
    const previousRootBackground = root.style.backgroundColor;
    const previousRootOverscroll = root.style.overscrollBehavior;
    const previousBodyOverscroll = document.body.style.overscrollBehavior;
    let themeColorMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const hadThemeColorMeta = Boolean(themeColorMeta);
    const previousThemeColor = themeColorMeta?.content ?? '';

    root.style.overflow = 'hidden';
    root.style.overscrollBehavior = 'none';
    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';
    document.body.style.setProperty('--app-mobile-nav-bg-current', navBackground);
    document.body.classList.add('app-mobile-nav-open');
    root.style.backgroundColor = navBackground;

    if (!themeColorMeta) {
      themeColorMeta = document.createElement('meta');
      themeColorMeta.name = 'theme-color';
      document.head.appendChild(themeColorMeta);
    }
    themeColorMeta.content = navBackground;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    const handleTouchMove = (event: TouchEvent) => {
      const menu = document.getElementById('mobile-primary-navigation');
      if (menu?.contains(event.target as Node)) return;
      event.preventDefault();
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });

    return () => {
      document.body.style.overflow = previousOverflow;
      root.style.overflow = previousRootOverflow;
      root.style.overscrollBehavior = previousRootOverscroll;
      document.body.style.overscrollBehavior = previousBodyOverscroll;
      document.body.classList.remove('app-mobile-nav-open');
      document.body.style.removeProperty('--app-mobile-nav-bg-current');
      root.style.backgroundColor = previousRootBackground;
      if (themeColorMeta) {
        if (hadThemeColorMeta) {
          themeColorMeta.content = previousThemeColor;
        } else {
          themeColorMeta.remove();
        }
      }
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('touchmove', handleTouchMove);
    };
  }, [isOpen, theme]);

  return (
    <>
      <button
        id="app-mobile-navigation-toggle"
        type="button"
        aria-label={isOpen ? 'Close navigation menu' : 'Open navigation menu'}
        aria-controls="mobile-primary-navigation"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="app-icon-button fixed right-4 top-4 z-50 h-11 w-11 min-[1050px]:hidden"
        style={{
          background: 'var(--app-nav-bg)',
          border: '1px solid var(--app-border)',
          color: 'var(--app-text)',
        }}
      >
        <AnimatedMobileMenuIcon isOpen={isOpen} shouldReduceMotion={shouldReduceMotion} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.nav
            id="mobile-primary-navigation"
            aria-label="Primary"
            className="fixed inset-x-0 -bottom-40 top-0 z-40 flex overscroll-contain flex-col overflow-y-auto px-5 pt-6 min-[1050px]:hidden"
            style={{
              background: 'var(--app-nav-bg)',
              color: 'var(--app-text)',
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: shouldReduceMotion ? 0.16 : mobileMenuFadeMs / 1000, ease: 'easeOut' }}
          >
            <motion.div
              className="flex min-h-[100dvh] flex-col pb-[calc(env(safe-area-inset-bottom)+2rem)]"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.22, delay: shouldReduceMotion ? 0 : 0.16, ease: 'easeOut' }}
            >
              <div className="pr-14">
                <NavigationBrand />
              </div>

              <div className="mt-10">
                <NavigationLinks onNavigate={() => setIsOpen(false)} />
              </div>

              <div className="mt-auto pt-8">
                <ThemeToggle
                  theme={theme}
                  setTheme={setTheme}
                  onThemeChange={() => setIsOpen(false)}
                />
              </div>

              <div className="pt-3">
                <UserProfile displayName={displayName} initials={initials} logout={logout} />
              </div>

              <VersionIndicator />
            </motion.div>
          </motion.nav>
        )}
      </AnimatePresence>
    </>
  );
}

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
    <>
      <DesktopNavigation
        theme={theme}
        setTheme={setTheme}
        displayName={displayName}
        initials={initials}
        logout={logout}
      />
      <MobileNavigation
        theme={theme}
        setTheme={setTheme}
        displayName={displayName}
        initials={initials}
        logout={logout}
      />
    </>
  );
};

export default Navigation;
