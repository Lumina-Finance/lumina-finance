export const View = {
  DASHBOARD: 'dashboard',
  ACCOUNTS: 'accounts',
  TRANSACTIONS: 'transactions',
  BUDGETS: 'budgets',
  INSIGHTS: 'insights',
  SETTINGS: 'settings',
} as const;

export type View = (typeof View)[keyof typeof View];

export type Theme = 'light' | 'dark' | 'system';
