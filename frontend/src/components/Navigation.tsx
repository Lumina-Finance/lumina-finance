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
  icon: LucideIcon;
  label: string;
}

const navItems: NavigationItem[] = [
  { icon: LayoutDashboard, label: 'Dashboard' },
  { icon: CreditCard, label: 'Accounts' },
  { icon: Receipt, label: 'Transactions' },
  { icon: PieChart, label: 'Budgets' },
  { icon: BarChart2, label: 'Insights' },
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
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <li
              key={item.label}
              className="flex items-center gap-3 px-3 py-2.5 font-medium text-[0.9375rem]"
              style={{ color: 'var(--app-text-muted)' }}
            >
              <Icon size={17} strokeWidth={1.75} className="shrink-0" aria-hidden />
              {item.label}
            </li>
          );
        })}

        <li aria-hidden className="mx-2 my-3 h-px" style={{ background: 'var(--app-border)' }} />

        <li
          className="flex items-center gap-3 px-3 py-2.5 font-medium text-[0.9375rem]"
          style={{ color: 'var(--app-text-muted)' }}
        >
          <Settings size={17} strokeWidth={1.75} className="shrink-0" aria-hidden />
          Settings
        </li>
      </ul>
    </nav>
  );
};

export default Navigation;
