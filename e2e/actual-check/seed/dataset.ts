/**
 * The budgets the check seeds into Actual, each covering shapes an import has to survive
 *
 * Dates are relative to the run date, with months counted back from the current one, so every run
 * holds a budget figure for this month, one that stopped last month, and a row dated tomorrow. Rows
 * written in the current month move to today when their day hasn't come yet, so the only row after
 * the run date is the one meant to be
 */
import { shiftMonth } from '../manifest.ts'
import type { ActualSession, api as ActualApi } from './actual.ts'

type Api = typeof ActualApi

/** Where one figure is written: a month and category, and the integer Actual stores */
export interface SeedFigure {
  month: string
  categoryId: string
  amount: number
  carryover: boolean
}

export interface SeedContext {
  api: Api
  session: ActualSession
  dates: RunDates
}

/** What a budget's seed wrote into Actual's two budget tables */
export interface SeededFigures {
  /** Figures in the table of the budget type that is on, which the import reads */
  figures: SeedFigure[]

  /** Figures left in the table of the type that is off, which the import must ignore */
  leftovers: SeedFigure[]
}

export interface BudgetDataset {
  /** Names the budget's folder in output/ and its test */
  name: string

  /** The budget's name in Actual */
  budgetName: string

  /** The currency Actual's currency feature is turned on with, or null to leave the feature off */
  currency: string | null
  seed: (context: SeedContext) => Promise<SeededFigures>
}

export class RunDates {
  readonly asOf: string

  constructor(asOf: string) {
    this.asOf = asOf
  }

  /** The month `offset` months from the current one, as YYYY-MM */
  month(offset: number) {
    return shiftMonth(this.asOf.slice(0, 7), offset)
  }

  /** A day of a month, moved back to the run date when it hasn't come yet */
  day(offset: number, dayOfMonth: number) {
    const date = `${this.month(offset)}-${String(dayOfMonth).padStart(2, '0')}`
    return date > this.asOf ? this.asOf : date
  }

  get tomorrow() {
    const next = new Date(`${this.asOf}T12:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    return next.toISOString().slice(0, 10)
  }
}

// Every amount below is written in hundredths, the scale Actual stores every transaction in
const cents = (value: number) => Math.round(value * 100)

// Actual dates an account's opening balance on the day the account is made
const EVERYTHING = ['2000-01-01', '2100-12-31'] as const

/**
 * Deletes the starter spending categories Actual gives a new budget, keeping its income group,
 * whose Starting Balances category Actual needs
 */
async function clearStarterCategories(api: Api) {
  const groups = await api.getCategoryGroups()
  for (const group of groups.filter((entry) => !entry.is_income)) {
    for (const category of group.categories ?? []) await api.deleteCategory(category.id)
    await api.deleteCategoryGroup(group.id)
  }
  const incomeGroup = groups.find((entry) => entry.is_income)
  if (!incomeGroup) throw new Error('A new Actual budget has no income group')
  return incomeGroup
}

/** Creates an account and moves its opening balance to the given day */
async function createAccount(api: Api, name: string, offbudget: boolean, openingBalance: number, openingDate: string) {
  const id = await api.createAccount({ name, offbudget }, openingBalance)
  for (const opening of await api.getTransactions(id, ...EVERYTHING)) {
    await api.updateTransaction(opening.id, { date: openingDate })
  }
  return id
}

async function findTransferPayee(api: Api, accountId: string) {
  const payee = (await api.getPayees()).find((entry) => entry.transfer_acct === accountId)
  if (!payee) throw new Error(`Actual made no transfer payee for account ${accountId}`)
  return payee.id
}

/**
 * The everyday budget: opening balances, spending, income, refunds, splits, on-budget transfers,
 * categorised payments to off-budget accounts, an off-budget account, a merged payee, a merged
 * category, a deleted row, a hidden category, tags and budget figures over twenty months
 */
const envelope: BudgetDataset = {
  name: 'envelope',
  budgetName: 'Import check envelope',
  currency: null,
  async seed({ api, dates }) {
    const MONTH_COUNT = 20

    // Month indexes run from the oldest month to the current one
    const monthAt = (index: number) => dates.month(index - (MONTH_COUNT - 1))
    const dayAt = (index: number, dayOfMonth: number) => dates.day(index - (MONTH_COUNT - 1), dayOfMonth)
    const openingDate = dayAt(0, 1)

    const incomeGroup = await clearStarterCategories(api)
    const defaultIncome = incomeGroup.categories?.find((entry) => ['Income', 'Salary'].includes(entry.name))
    if (!defaultIncome) throw new Error('A new Actual budget has no Income category')

    // Actual's update needs the name even when only another field changes
    await api.updateCategory(defaultIncome.id, { name: 'Salary' })

    const living = await api.createCategoryGroup({ name: 'Living' })
    const lifestyle = await api.createCategoryGroup({ name: 'Lifestyle' })
    const saving = await api.createCategoryGroup({ name: 'Saving & Debt' })
    const category = {
      salary: defaultIncome.id,
      interest: await api.createCategory({ name: 'Interest', group_id: incomeGroup.id, is_income: true }),
      groceries: await api.createCategory({ name: 'Groceries', group_id: living }),
      rent: await api.createCategory({ name: 'Rent', group_id: living }),
      utilities: await api.createCategory({ name: 'Utilities', group_id: living }),
      diningOut: await api.createCategory({ name: 'Dining Out', group_id: living }),
      eatingOut: await api.createCategory({ name: 'Eating Out', group_id: living }),
      hobbies: await api.createCategory({ name: 'Hobbies', group_id: lifestyle }),
      travel: await api.createCategory({ name: 'Travel', group_id: lifestyle }),
      cafe: await api.createCategory({ name: 'Café & Snacks', group_id: lifestyle }),
      oldHobby: await api.createCategory({ name: 'Old Hobby', group_id: lifestyle }),
      carPayment: await api.createCategory({ name: 'Car Payment', group_id: saving }),
      investing: await api.createCategory({ name: 'Investing', group_id: saving }),
    }

    const account = {
      checking: await createAccount(api, 'Everyday Checking', false, cents(2450), openingDate),
      savings: await createAccount(api, 'Rainy Day Savings', false, cents(8000), openingDate),
      visa: await createAccount(api, 'Visa Card', false, -cents(350.25), openingDate),
      wallet: await createAccount(api, 'Café Wallet ☕', false, cents(60), openingDate),
      joint: await createAccount(api, 'Old Joint Checking', false, cents(500), openingDate),
      brokerage: await createAccount(api, 'Brokerage', true, cents(15000), openingDate),
      carLoan: await createAccount(api, 'Car Loan', true, -cents(12000), openingDate),
    }

    const payee = {
      loblaws: await api.createPayee({ name: 'Loblaws' }),
      loblawsStore: await api.createPayee({ name: 'LOBLAWS #1234' }),
      landlord: await api.createPayee({ name: 'Landlord Co' }),
      hydro: await api.createPayee({ name: 'Hydro Ottawa' }),
      employer: await api.createPayee({ name: 'Acme Corp' }),
      bank: await api.createPayee({ name: 'Bank Interest' }),
      cafe: await api.createPayee({ name: 'Café Olé' }),
      airline: await api.createPayee({ name: 'Air Canada' }),
      tire: await api.createPayee({ name: 'Canadian Tire' }),
      market: await api.createPayee({ name: 'Market Movement' }),
      lender: await api.createPayee({ name: 'Car Loan Interest' }),
      gym: await api.createPayee({ name: 'Gym' }),
      parking: await api.createPayee({ name: 'Parking Meter' }),
    }
    const transferTo = {
      savings: await findTransferPayee(api, account.savings),
      visa: await findTransferPayee(api, account.visa),
      carLoan: await findTransferPayee(api, account.carLoan),
      brokerage: await findTransferPayee(api, account.brokerage),
      checking: await findTransferPayee(api, account.checking),
    }

    type Row = Parameters<Api['addTransactions']>[1][number]
    const rows = new Map<string, Row[]>(Object.values(account).map((id) => [id, []]))
    const add = (accountId: string, row: Row) => rows.get(accountId)!.push(row)

    for (let index = 0; index < MONTH_COUNT; index++) {
      add(account.checking, { date: dayAt(index, 1), amount: cents(4200), payee: payee.employer, category: category.salary })
      add(account.checking, { date: dayAt(index, 1), amount: -cents(1650), payee: payee.landlord, category: category.rent })
      add(account.checking, { date: dayAt(index, 12), amount: -cents(80 + index * 1.37), payee: payee.hydro, category: category.utilities })
      add(account.checking, { date: dayAt(index, 7), amount: -cents(120.45 + index), payee: payee.loblaws, category: category.groceries })
      add(account.visa, { date: dayAt(index, 18), amount: -cents(64.1), payee: payee.loblawsStore, category: category.groceries })
      add(account.wallet, {
        date: dayAt(index, 22),
        amount: -cents(23.75),
        payee: payee.cafe,
        category: index < 6 ? category.eatingOut : category.diningOut,
      })

      // Between two on-budget accounts, so neither side carries a category
      add(account.checking, { date: dayAt(index, 15), amount: -cents(300), payee: transferTo.savings })
      add(account.checking, { date: dayAt(index, 20), amount: -cents(200), payee: transferTo.visa })

      // From on-budget to off-budget, which Actual budgets as spending in the category
      add(account.checking, { date: dayAt(index, 5), amount: -cents(425), payee: transferTo.carLoan, category: category.carPayment })
      if (index % 2 === 0) {
        add(account.checking, { date: dayAt(index, 25), amount: -cents(250), payee: transferTo.brokerage, category: category.investing })
      }

      // Ordinary off-budget rows, which have no category in Actual
      add(account.brokerage, { date: dayAt(index, 28), amount: cents(index % 3 === 0 ? -140.5 : 212.34), payee: payee.market })
      add(account.carLoan, { date: dayAt(index, 5), amount: -cents(45.1), payee: payee.lender })

      add(account.savings, { date: dayAt(index, 28), amount: cents(3.12), payee: payee.bank, category: category.interest })

      if (index % 3 === 1) {
        add(account.visa, {
          date: dayAt(index, 9),
          amount: -cents(150),
          payee: payee.tire,
          notes: 'Garden and garage',
          subtransactions: [
            { amount: -cents(100), category: category.hobbies, notes: 'Garden tools' },
            { amount: -cents(50), category: category.utilities },
          ],
        })
      }
    }

    add(account.visa, { date: dayAt(6, 3), amount: -cents(612.4), payee: payee.airline, category: category.travel, notes: 'Flight to Lisbon #travel #summer-trip' })
    add(account.visa, { date: dayAt(7, 14), amount: cents(35), payee: payee.tire, category: category.hobbies, notes: 'Returned a rake' })
    add(account.wallet, { date: dayAt(10, 8), amount: -cents(86.2), payee: payee.cafe, category: category.diningOut, notes: 'Birthday dinner #family #celebration' })
    add(account.wallet, { date: dayAt(14, 2), amount: -cents(4.5), payee: payee.cafe, category: category.cafe })
    add(account.checking, { date: dayAt(1, 11), amount: -cents(45), payee: payee.tire, category: category.oldHobby, notes: 'Model paints' })
    add(account.checking, { date: dayAt(15, 19), amount: -cents(18), payee: payee.parking })
    add(account.brokerage, { date: dayAt(17, 1), amount: cents(125000), payee: payee.market, notes: 'Inheritance transferred in kind' })

    // Dated after the run date, which the import leaves out and lists
    add(account.checking, { date: dates.tomorrow, amount: -cents(99), payee: payee.gym, category: category.hobbies })

    // The joint account runs for half a year, empties into checking and closes
    add(account.joint, { date: dayAt(1, 3), amount: -cents(40), payee: payee.loblaws, category: category.groceries })
    add(account.joint, { date: dayAt(2, 3), amount: -cents(62.8), payee: payee.loblaws, category: category.groceries })
    add(account.joint, { date: dayAt(5, 28), amount: -cents(397.2), payee: transferTo.checking })

    for (const [accountId, accountRows] of rows) {
      await api.addTransactions(accountId, accountRows, { runTransfers: true })
    }

    // A row entered by mistake and deleted, which stays in the file as a tombstone
    const mistakeDate = dayAt(4, 5)
    await api.addTransactions(account.checking, [
      { date: mistakeDate, amount: -cents(999), payee: payee.loblaws, category: category.groceries, notes: 'Entered twice by mistake' },
    ])
    const mistaken = (await api.getTransactions(account.checking, mistakeDate, mistakeDate))
      .find((transaction) => transaction.notes === 'Entered twice by mistake')
    if (!mistaken) throw new Error('The mistaken row was never written')
    await api.deleteTransaction(mistaken.id)

    await api.closeAccount(account.joint)
    await api.mergePayees(payee.loblaws, [payee.loblawsStore])
    await api.deleteCategory(category.eatingOut, category.diningOut)
    await api.updateCategory(category.oldHobby, { name: 'Old Hobby', hidden: true })

    const figures: SeedFigure[] = []
    const setFigure = async (index: number, categoryId: string, amount: number, carryover = false) => {
      await api.setBudgetAmount(monthAt(index), categoryId, amount)
      if (carryover) await api.setBudgetCarryover(monthAt(index), categoryId, true)
      figures.push({ month: monthAt(index), categoryId, amount, carryover })
    }
    const monthlyBudget: [string, number][] = [
      [category.groceries, 450],
      [category.rent, 1650],
      [category.utilities, 110],
      [category.diningOut, 120],
      [category.carPayment, 425],
    ]
    await api.batchBudgetUpdates(async () => {
      for (let index = 0; index < MONTH_COUNT; index++) {
        for (const [categoryId, amount] of monthlyBudget) await setFigure(index, categoryId, cents(amount))
        await setFigure(index, category.travel, cents(150), true)

        // Hobbies skips the summer, so those months have no period
        if (index % 12 !== 6 && index % 12 !== 7) await setFigure(index, category.hobbies, cents(80))

        // Every other month, ending last month
        if (index % 2 === 0) await setFigure(index, category.investing, cents(250))
      }
      await setFigure(0, category.oldHobby, cents(40))
    })
    return { figures, leftovers: [] }
  },
}

/**
 * The awkward shapes the envelope budget leaves out: deleted accounts with transfers to them, a
 * split part that is a transfer, a split that no longer adds up, a zero transfer, a transfer linked
 * one way only, a closed account with money left, a category merged into one later deleted, a
 * hidden category group, two categories sharing a name, and one category used both on spending
 * and on payments to an off-budget account
 */
const edges: BudgetDataset = {
  name: 'edges',
  budgetName: 'Import check edges',
  currency: null,
  async seed({ api, session, dates }) {
    const incomeGroup = await clearStarterCategories(api)
    const income = incomeGroup.categories?.find((entry) => entry.name === 'Income')?.id
    if (!income) throw new Error('A new Actual budget has no Income category')

    const home = await api.createCategoryGroup({ name: 'Home' })
    const away = await api.createCategoryGroup({ name: 'Away' })
    const retired = await api.createCategoryGroup({ name: 'Retired' })
    const category = {
      groceries: await api.createCategory({ name: 'Groceries', group_id: home }),
      car: await api.createCategory({ name: 'Car', group_id: home }),
      homeTravel: await api.createCategory({ name: 'Travel', group_id: home }),
      awayTravel: await api.createCategory({ name: 'Travel', group_id: away }),
      snacks: await api.createCategory({ name: 'Snacks', group_id: away }),
      treats: await api.createCategory({ name: 'Treats', group_id: away }),
      gym: await api.createCategory({ name: 'Gym', group_id: retired }),
    }

    const openingDate = dates.day(-2, 1)
    const account = {
      checking: await createAccount(api, 'Checking', false, cents(5000), openingDate),
      savings: await createAccount(api, 'Savings', false, cents(1000), openingDate),
      wallet: await createAccount(api, 'Wallet', false, cents(80), openingDate),
      paypal: await createAccount(api, 'Old PayPal', false, 0, openingDate),
      carLoan: await createAccount(api, 'Car Loan', true, -cents(9000), openingDate),
      oldLoan: await createAccount(api, 'Old Loan', true, -cents(500), openingDate),
    }

    const transferTo = {
      savings: await findTransferPayee(api, account.savings),
      wallet: await findTransferPayee(api, account.wallet),
      paypal: await findTransferPayee(api, account.paypal),
      carLoan: await findTransferPayee(api, account.carLoan),
      oldLoan: await findTransferPayee(api, account.oldLoan),
    }
    const shop = await api.createPayee({ name: 'Corner Shop' })
    const employer = await api.createPayee({ name: 'Employer' })
    const garage = await api.createPayee({ name: 'Garage' })
    const gym = await api.createPayee({ name: 'Iron Gym' })

    const unbalancedDate = dates.day(-2, 10)
    const oneWayDate = dates.day(-1, 15)
    await api.addTransactions(account.checking, [
      { date: dates.day(-2, 2), amount: cents(3000), payee: employer, category: income },
      { date: dates.day(-2, 3), amount: -cents(64.2), payee: shop, category: category.groceries },
      { date: dates.day(-2, 4), amount: -cents(45), payee: garage, category: category.car, notes: 'Oil change #car' },
      { date: dates.day(-2, 5), amount: -cents(300), payee: transferTo.carLoan, category: category.car, notes: 'First payment' },
      { date: dates.day(-2, 6), amount: -cents(120), payee: transferTo.paypal },
      { date: dates.day(-2, 7), amount: -cents(100), payee: transferTo.oldLoan, category: category.car },
      { date: dates.day(-2, 8), amount: 0, payee: transferTo.savings, notes: 'Zero transfer' },
      {
        date: dates.day(-2, 9),
        amount: -cents(210),
        payee: shop,
        notes: 'Trip shop #holiday',
        subtransactions: [
          { amount: -cents(150), category: category.homeTravel, notes: 'Hotel' },
          // The API types leave a payee off split parts, though Actual takes one and makes the part a transfer
          { amount: -cents(60), payee: transferTo.savings, notes: 'Put aside' } as { amount: number },
        ],
      },
      {
        date: unbalancedDate,
        amount: -cents(90),
        payee: shop,
        subtransactions: [
          { amount: -cents(40), category: category.awayTravel },
          { amount: -cents(50), category: category.snacks },
        ],
      },
      { date: dates.day(-2, 11), amount: -cents(12.5), payee: shop, category: category.treats },
      { date: dates.day(-2, 12), amount: -cents(35), payee: gym, category: category.gym },
      { date: dates.day(-1, 2), amount: cents(3000), payee: employer, category: income },
      { date: dates.day(-1, 5), amount: -cents(300), payee: transferTo.carLoan, category: category.car, notes: 'Second payment' },
      { date: dates.day(-1, 12), amount: -cents(35), payee: gym, category: category.gym },
      { date: oneWayDate, amount: -cents(75), payee: transferTo.savings, notes: 'Linked one way' },
      { date: dates.day(0, 5), amount: -cents(300), payee: transferTo.carLoan, category: category.car, notes: 'Third payment' },
      { date: dates.day(0, 10), amount: -cents(20), payee: transferTo.wallet },
    ], { runTransfers: true })
    await api.addTransactions(account.paypal, [
      { date: dates.day(-2, 15), amount: -cents(25), payee: shop, category: category.snacks },
    ])
    await api.addTransactions(account.carLoan, [
      { date: dates.day(-2, 28), amount: -cents(38.4), payee: garage, notes: 'Interest charged' },
    ])

    // The unbalanced split: its second part is edited after the split was saved, which Actual
    // allows and flags on the split rather than refusing
    const [unbalanced] = await api.getTransactions(account.checking, unbalancedDate, unbalancedDate)
      .then((found) => found.filter((transaction) => transaction.amount === -cents(90)))
    const unbalancedPart = unbalanced?.subtransactions?.find((part) => part.category === category.snacks)
    if (!unbalancedPart) throw new Error('The split to unbalance was never written')
    await api.updateTransaction(unbalancedPart.id, { amount: -cents(55) })

    // The savings side of this transfer loses its link while keeping its transfer payee, so only
    // the checking side still names the other
    const oneWay = (await api.getTransactions(account.checking, oneWayDate, oneWayDate))
      .find((transaction) => transaction.notes === 'Linked one way')
    if (!oneWay?.transfer_id) throw new Error('The transfer to link one way was never written')
    await session.unlinkTransferSide(oneWay.transfer_id)
    const unlinked = (await api.getTransactions(account.savings, oneWayDate, oneWayDate))
      .find((transaction) => transaction.id === oneWay.transfer_id)
    if (!unlinked || unlinked.transfer_id || !unlinked.payee) throw new Error('Actual did not keep the savings side of the transfer linked one way')

    // Treats is merged into Snacks, and Snacks is then deleted without moving its rows anywhere
    await api.deleteCategory(category.treats, category.snacks)
    await api.deleteCategory(category.snacks)

    await api.updateCategoryGroup(retired, { name: 'Retired', hidden: true })

    const figures: SeedFigure[] = []
    const setFigure = async (offset: number, categoryId: string, amount: number) => {
      await api.setBudgetAmount(dates.month(offset), categoryId, amount)
      figures.push({ month: dates.month(offset), categoryId, amount, carryover: false })
    }

    // Groceries and Gym stop last month, and Car runs on into next month
    for (const offset of [-2, -1]) {
      await setFigure(offset, category.groceries, cents(400))
      await setFigure(offset, category.gym, cents(35))
    }
    for (const offset of [-2, -1, 0, 1]) await setFigure(offset, category.car, cents(350))
    await setFigure(-2, category.homeTravel, cents(200))
    await setFigure(-2, category.awayTravel, cents(50))

    await api.deleteAccount(account.paypal)
    await api.deleteAccount(account.oldLoan)

    // Closing an account through the API skips the screen that asks where its balance goes
    await api.updateAccount(account.wallet, { closed: true })
    return { figures, leftovers: [] }
  },
}

/**
 * A tracking budget in Canadian dollars with the currency feature on. Its envelope figures are
 * typed first and the budget then switches to tracking, so they stay in the file in the table of
 * the type that is off
 */
const tracking: BudgetDataset = {
  name: 'tracking',
  budgetName: 'Import check tracking',
  currency: 'CAD',
  async seed({ api, session, dates }) {
    const incomeGroup = await clearStarterCategories(api)
    const salary = incomeGroup.categories?.find((entry) => entry.name === 'Income')?.id
    if (!salary) throw new Error('A new Actual budget has no Income category')
    await api.updateCategory(salary, { name: 'Salary' })
    const living = await api.createCategoryGroup({ name: 'Living' })
    const groceries = await api.createCategory({ name: 'Groceries', group_id: living })
    const rent = await api.createCategory({ name: 'Rent', group_id: living })

    const openingDate = dates.day(-3, 1)
    const chequing = await createAccount(api, 'Chequing', false, cents(3000), openingDate)
    const visa = await createAccount(api, 'Visa', false, -cents(200), openingDate)
    const toVisa = await findTransferPayee(api, visa)
    const employer = await api.createPayee({ name: 'Employer' })
    const landlord = await api.createPayee({ name: 'Landlord' })
    const grocer = await api.createPayee({ name: 'Grocer' })

    for (const offset of [-3, -2, -1, 0]) {
      await api.addTransactions(chequing, [
        { date: dates.day(offset, 1), amount: cents(4200), payee: employer, category: salary },
        { date: dates.day(offset, 1), amount: -cents(1650), payee: landlord, category: rent },
        { date: dates.day(offset, 7), amount: -cents(123.45), payee: grocer, category: groceries },
        { date: dates.day(offset, 20), amount: -cents(200), payee: toVisa },
      ], { runTransfers: true })
      await api.addTransactions(visa, [
        { date: dates.day(offset, 18), amount: -cents(64.1), payee: grocer, category: groceries },
      ])
    }

    const write = async (target: SeedFigure[], offset: number, categoryId: string, amount: number) => {
      await api.setBudgetAmount(dates.month(offset), categoryId, amount)
      target.push({ month: dates.month(offset), categoryId, amount, carryover: false })
    }

    // Typed while the budget is still envelope, so these land in its table
    const leftovers: SeedFigure[] = []
    for (const offset of [-2, -1]) {
      await write(leftovers, offset, groceries, cents(999))
      await write(leftovers, offset, salary, cents(4200))
    }

    await session.savePreference('budgetType', 'tracking')
    const figures: SeedFigure[] = []
    for (const offset of [-3, -2, -1, 0]) {
      await write(figures, offset, groceries, cents(450))
      await write(figures, offset, rent, cents(1650))
      await write(figures, offset, salary, cents(4200))
    }
    return { figures, leftovers }
  },
}

/**
 * An envelope budget in yen with the currency feature on. Actual 26.9 stores what its transaction
 * screens take in hundredths even for yen, and what its budget screen takes in whole yen, so the
 * rows here are written in hundredths and the figures in whole yen
 */
const yen: BudgetDataset = {
  name: 'yen',
  budgetName: 'Import check yen',
  currency: 'JPY',
  async seed({ api, dates }) {
    const yenRow = (value: number) => value * 100
    const incomeGroup = await clearStarterCategories(api)
    const income = incomeGroup.categories?.find((entry) => entry.name === 'Income')?.id
    if (!income) throw new Error('A new Actual budget has no Income category')
    const usual = await api.createCategoryGroup({ name: 'Usual Expenses' })
    const food = await api.createCategory({ name: 'Food', group_id: usual })
    const general = await api.createCategory({ name: 'General', group_id: usual })
    const bills = await api.createCategory({ name: 'Bills', group_id: usual })

    const openingDate = dates.day(-2, 1)
    const checking = await createAccount(api, 'Tokyo Checking', false, yenRow(250000), openingDate)
    const suica = await createAccount(api, 'Suica Card', false, yenRow(3000), openingDate)
    const toSuica = await findTransferPayee(api, suica)
    const employer = await api.createPayee({ name: '東京商事' })
    const landlord = await api.createPayee({ name: 'Tokyo Landlord' })
    const lawson = await api.createPayee({ name: 'Lawson' })
    const railway = await api.createPayee({ name: 'JR East' })

    await api.addTransactions(checking, [
      { date: dates.day(-2, 1), amount: yenRow(320000), payee: employer, category: income },
      { date: dates.day(-2, 5), amount: -yenRow(95000), payee: landlord, category: bills },
      { date: dates.day(-2, 10), amount: -yenRow(4580), payee: lawson, category: food },
      { date: dates.day(-2, 15), amount: -yenRow(5000), payee: toSuica },
      { date: dates.day(-1, 1), amount: yenRow(320000), payee: employer, category: income },
      { date: dates.day(-1, 5), amount: -yenRow(95000), payee: landlord, category: bills },
      { date: dates.day(-1, 12), amount: -yenRow(7123), payee: lawson, category: food, notes: 'Weekly shop #groceries' },
    ], { runTransfers: true })
    await api.addTransactions(suica, [
      { date: dates.day(-2, 20), amount: -yenRow(1240), payee: railway, category: general },
    ])

    // A blank row typed and deleted, which stays in the file as a tombstone
    const blankDate = dates.day(-2, 10)
    await api.addTransactions(checking, [{ date: blankDate, amount: 0, notes: 'Typed by mistake' }])
    const blank = (await api.getTransactions(checking, blankDate, blankDate)).find((row) => row.notes === 'Typed by mistake')
    if (!blank) throw new Error('The blank row was never written')
    await api.deleteTransaction(blank.id)

    const figures: SeedFigure[] = []
    const setFigure = async (offset: number, categoryId: string, amount: number) => {
      await api.setBudgetAmount(dates.month(offset), categoryId, amount)
      figures.push({ month: dates.month(offset), categoryId, amount, carryover: false })
    }

    // Bills runs through this month and Food stops last month
    for (const offset of [-2, -1, 0]) await setFigure(offset, bills, 95000)
    for (const offset of [-2, -1]) await setFigure(offset, food, 30000)
    return { figures, leftovers: [] }
  },
}

export const DATASETS: BudgetDataset[] = [envelope, edges, tracking, yen]
