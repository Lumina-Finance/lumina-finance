import { NavLink } from 'react-router-dom';
import {
  BarChart2,
  CreditCard,
  LayoutDashboard,
  PieChart,
  Receipt,
  Settings,
  type LucideIcon,
} from 'lucide-react';

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
  return (
    <nav
      aria-label="Primary"
      className="sticky top-5 flex flex-col w-60 shrink-0 rounded-2xl px-4 py-7 m-5 mr-0"
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
    </nav>
  );
};

export default Navigation;
