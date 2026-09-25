/**
 * The fixed dataset the check seeds into Firefly III: two years of an ordinary household, plus the
 * awkward cases an import has to survive
 *
 * Everything is data built from fixed dates and a seeded generator, so every seed writes the same
 * Firefly III records and the same manifest
 */

export const DATASET_START = '2024-01-01'

/** The date the manifest measures at, the dataset's last day */
export const AS_OF = '2025-12-31'

/** Decimal places Firefly III and Lumina both keep for the dataset's currencies */
export const CURRENCY_EXPONENTS: Record<string, number> = { EUR: 2, USD: 2, JPY: 0 }

export interface SeedAccount {
  name: string
  body: Record<string, unknown>

  /** Deactivated once its rows are in, since Firefly III takes no rows on an inactive account */
  deactivate?: boolean
}

export interface SeedSplit {
  type: 'withdrawal' | 'deposit' | 'transfer'
  date: string
  amount: string
  description: string

  /** An imported account, named as it was created */
  source?: string
  destination?: string

  /** A payee outside the import, which Firefly III files as an expense or revenue account */
  sourceName?: string
  destinationName?: string
  category?: string
  budget?: string
  tags?: string[]
  notes?: string
  foreignAmount?: string
  foreignCurrency?: string
}

export interface SeedGroup {
  title?: string
  splits: SeedSplit[]
}

export interface SeedBudget {
  name: string
  limits: { start: string; end: string; amount: string; currency: string }[]
  deactivate?: boolean
}

export const ACCOUNTS: SeedAccount[] = [
  {
    name: 'Checking',
    body: { type: 'asset', currency_code: 'EUR', account_role: 'defaultAsset', opening_balance: '2500.00', opening_balance_date: '2024-01-01' },
  },
  { name: 'Savings', body: { type: 'asset', currency_code: 'EUR', account_role: 'savingAsset' } },
  {
    name: 'US Card',
    body: {
      type: 'asset',
      currency_code: 'USD',
      account_role: 'ccAsset',
      credit_card_type: 'monthlyFull',
      monthly_payment_date: '2024-01-28',
    },
  },
  {
    name: 'Yen Wallet',
    body: { type: 'asset', currency_code: 'JPY', account_role: 'cashWalletAsset', opening_balance: '40000', opening_balance_date: '2024-01-01' },
  },

  // A name starting with @, which Firefly III's CSV writer escapes as a formula
  { name: '@Home Fund', body: { type: 'asset', currency_code: 'EUR', account_role: 'savingAsset' } },
  {
    name: 'Car Loan',
    body: {
      type: 'liabilities',
      currency_code: 'EUR',
      liability_type: 'loan',
      liability_direction: 'debit',
      opening_balance: '-12000.00',
      opening_balance_date: '2024-01-05',
      interest: '3.5',
      interest_period: 'monthly',
    },
  },
  {
    name: 'Owed by Sam',
    body: {
      type: 'liabilities',
      currency_code: 'EUR',
      liability_type: 'debt',
      liability_direction: 'credit',
      opening_balance: '400.00',
      opening_balance_date: '2024-02-01',
      interest: '0',
      interest_period: 'monthly',
    },
  },
  {
    name: 'Old Account',
    body: { type: 'asset', currency_code: 'EUR', account_role: 'defaultAsset', opening_balance: '50.00', opening_balance_date: '2024-01-01' },
    deactivate: true,
  },
]

const MONTHS = Array.from({ length: 24 }, (_, index) => {
  const year = 2024 + Math.floor(index / 12)
  return `${year}-${String((index % 12) + 1).padStart(2, '0')}`
})

/** Mulberry32, so the ordinary spending is varied but identical on every seed */
function createRandom(seed: number) {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function money(random: () => number, min: number, max: number) {
  return (min + random() * (max - min)).toFixed(2)
}

const GROCERS = ['Café Émile', 'FreshMart', '🛒 Corner Market', 'Épicerie Ōsaka']
const LONG_NOTES = Array.from({ length: 100 }, (_, index) => `Line ${index + 1} of a long receipt note.`).join('\n').padEnd(5000, '.')

export function buildGroups(): SeedGroup[] {
  const random = createRandom(20240101)
  const groups: SeedGroup[] = []
  const add = (...splits: SeedSplit[]) => groups.push({ splits })

  for (const [index, month] of MONTHS.entries()) {
    add({ type: 'withdrawal', date: `${month}-01`, amount: '1450.00', description: 'Rent', source: 'Checking', destinationName: 'Landlord', category: 'Rent' })
    add({ type: 'transfer', date: `${month}-05`, amount: '200.00', description: 'Monthly saving', source: 'Checking', destination: 'Savings', category: 'Savings plan' })

    // A loan repayment is a Firefly III withdrawal into the liability
    add({ type: 'withdrawal', date: `${month}-10`, amount: '350.00', description: 'Car loan repayment', source: 'Checking', destination: 'Car Loan', category: 'Loan payments' })
    add({ type: 'withdrawal', date: `${month}-12`, amount: '1200', description: 'Ramen', source: 'Yen Wallet', destinationName: 'Ramen Ya', category: 'Eating out' })
    add({ type: 'deposit', date: `${month}-25`, amount: '3200.00', description: 'Salary', sourceName: 'Employer Inc', destination: 'Checking', category: 'Salary' })

    for (const [week, day] of ['03', '11', '18', '26'].entries()) {
      add({
        type: 'withdrawal',
        date: `${month}-${day}`,
        amount: money(random, 18, 140),
        description: 'Weekly groceries',
        source: 'Checking',
        destinationName: GROCERS[(index + week) % GROCERS.length],
        category: 'Groceries',
        budget: 'Food',
      })
    }

    // Card spending in dollars, paid off from the euro account with the dollar amount as foreign
    const cardSpend = money(random, 60, 240)
    add({ type: 'withdrawal', date: `${month}-14`, amount: cardSpend, description: 'Hotel', source: 'US Card', destinationName: 'Hotel NYC', category: 'Travel', budget: 'Travel' })
    add({
      type: 'transfer',
      date: `${month}-28`,
      amount: (Number(cardSpend) * 0.92).toFixed(2),
      description: 'Pay the card',
      source: 'Checking',
      destination: 'US Card',
      foreignAmount: cardSpend,
      foreignCurrency: 'USD',
    })

    if (index % 2 === 0) {
      add({ type: 'withdrawal', date: `${month}-07`, amount: '5.00', description: 'Parking', source: 'Checking', destinationName: 'City Parking' })
    }
    if (index % 3 === 0) {
      add({
        type: 'withdrawal',
        date: `${month}-16`,
        amount: '18.40',
        description: 'Book from the US',
        source: 'Checking',
        destinationName: 'US Books',
        category: 'Books',
        foreignAmount: '19.99',
        foreignCurrency: 'USD',
      })
      groups.push({
        title: 'Big Store run',
        splits: [
          { type: 'withdrawal', date: `${month}-20`, amount: money(random, 30, 90), description: 'Big Store: food', source: 'Checking', destinationName: 'Big Store', category: 'Groceries', budget: 'Food' },
          { type: 'withdrawal', date: `${month}-20`, amount: money(random, 10, 60), description: 'Big Store: home', source: 'Checking', destinationName: 'Big Store', category: 'Household' },
        ],
      })
    }
    if (index % 4 === 1) {
      add({ type: 'deposit', date: `${month}-22`, amount: '12.34', description: 'Refund', sourceName: 'FreshMart', destination: 'Checking', category: 'Groceries' })
    }
    if (index % 6 === 5) {
      add({ type: 'withdrawal', date: `${month}-15`, amount: '100.00', description: 'To the joint account', source: 'Checking', destinationName: 'Joint account (other bank)' })
      add({ type: 'transfer', date: `${month}-19`, amount: '75.00', description: 'Top up the home fund', source: 'Checking', destination: '@Home Fund' })
    }
  }

  // Sam pays back part of what they owe, and a dealer refund lowers the car loan
  add({ type: 'deposit', date: '2024-06-15', amount: '150.00', description: 'Sam paid back', source: 'Owed by Sam', destination: 'Checking' })
  add({ type: 'deposit', date: '2024-09-03', amount: '80.00', description: 'Dealer refund', sourceName: 'Car Dealer', destination: 'Car Loan', category: 'Refunds' })

  // Rows on the account that is deactivated afterwards
  add({ type: 'withdrawal', date: '2024-02-09', amount: '20.00', description: 'Old habit', source: 'Old Account', destinationName: 'Kiosk', category: 'Hobbies', budget: 'Retired' })
  add({ type: 'transfer', date: '2024-03-01', amount: '30.00', description: 'Close out the old account', source: 'Old Account', destination: 'Checking' })

  // A budget tracked only for a few weeks
  for (const [day, amount] of [['2025-03-04', '14.50'], ['2025-03-12', '22.00'], ['2025-03-19', '9.75']]) {
    add({ type: 'withdrawal', date: day, amount, description: 'Cinema', source: 'Checking', destinationName: 'Cinéma Lumière', category: 'Entertainment', budget: 'Weekly fun' })
  }

  // Names and text Firefly III's CSV writer escapes, or that break a naive reader
  for (const [day, payee] of [['02', '-Minus Shop'], ['03', '+Plus Shop'], ['04', '=Equals Shop'], ['05', '@At Shop']]) {
    add({ type: 'withdrawal', date: `2025-06-${day}`, amount: '7.00', description: `Bought at ${payee}`, source: 'Checking', destinationName: payee, category: 'Household' })
  }
  add({ type: 'withdrawal', date: '2025-06-06', amount: '8.00', description: "'Quoted once", source: 'Checking', destinationName: "'Apostrophe Café", category: 'Household' })
  add({ type: 'withdrawal', date: '2025-06-07', amount: '9.00', description: "''Quoted twice", source: 'Checking', destinationName: "''Double Apostrophe", category: 'Household' })
  add({ type: 'withdrawal', date: '2025-06-08', amount: '11.00', description: 'Long receipt', source: 'Checking', destinationName: 'Stationer', category: 'Household', notes: LONG_NOTES })
  add({
    type: 'withdrawal',
    date: '2025-06-09',
    amount: '12.00',
    description: 'Many tags',
    source: 'Checking',
    destinationName: 'Market Stall',
    category: 'Household',
    tags: Array.from({ length: 20 }, (_, index) => `tag-${String(index + 1).padStart(2, '0')}`),
  })
  add({ type: 'withdrawal', date: '2025-06-10', amount: '13.00', description: 'Tag with a comma', source: 'Checking', destinationName: 'Market Stall', category: 'Household', tags: ['a,b', 'plain'] })

  // Far past any day the export runs, and the export ends on that day, so an import that ever
  // brings this row in shows the export has stopped leaving future rows out
  add({ type: 'withdrawal', date: '2099-01-15', amount: '70.00', description: 'Future dated', source: 'Checking', destinationName: 'Future Shop', category: 'Household' })

  return groups
}

export const BUDGETS: SeedBudget[] = [
  {
    name: 'Food',
    limits: MONTHS.map((month, index) => ({
      start: `${month}-01`,
      end: lastDayOf(month),
      amount: index < 12 ? '300.00' : '320.00',
      currency: 'EUR',
    })),
  },
  {
    name: 'Travel',
    limits: [
      { start: '2024-01-01', end: '2024-12-31', amount: '2000.00', currency: 'USD' },
      { start: '2025-01-01', end: '2025-12-31', amount: '2400.00', currency: 'USD' },
    ],
  },
  {
    name: 'Weekly fun',
    limits: ['2025-03-03', '2025-03-10', '2025-03-17', '2025-03-24'].map((start) => ({
      start,
      end: addDays(start, 6),
      amount: '40.00',
      currency: 'EUR',
    })),
  },
  {
    name: 'Retired',
    limits: [{ start: '2024-02-01', end: '2024-02-29', amount: '50.00', currency: 'EUR' }],
    deactivate: true,
  },
]

function lastDayOf(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10)
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
