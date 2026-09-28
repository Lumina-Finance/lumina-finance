/**
 * Tests reading Actual Budget files through the real zip and SQLite libraries, against exports a
 * local Actual 26.9 server wrote and the manifests measured from that server
 */
import { zipSync } from 'fflate'
import initSqlJs from 'sql.js'
import { describe, expect, it } from 'vitest'
import { MAX_ACTUAL_DATABASE_BYTES } from '@/pages/imports/actual/constants'
import type { ActualBudgetFile } from '@/pages/imports/actual/types'
import { readActualBudgetFile } from '@/pages/imports/actual/utils/readFile'
import { readActualFixture, readActualManifest, unzipActualDatabase } from './fixtures'

// sql.js finds its wasm beside itself under Node, where the browser build's asset URL means nothing
const loadNodeSqlEngine = () => initSqlJs()

async function readBudget(file: File): Promise<ActualBudgetFile> {
  const read = await readActualBudgetFile(file, loadNodeSqlEngine)
  if (read.status !== 'read') throw new Error(read.reason)
  return read.budget
}

async function readRefusal(file: File) {
  const read = await readActualBudgetFile(file, loadNodeSqlEngine)
  if (read.status !== 'refused') throw new Error('The file was read')
  return read.reason
}

/** Counts what a query over a database selects */
async function countRows(bytes: Uint8Array, query: string) {
  const engine = await loadNodeSqlEngine()
  const database = new engine.Database(bytes)
  const [result] = database.exec(query)
  database.close()
  return Number(result.values[0][0])
}

/** Rewrites a database with a change, so a refusal comes from a real Actual file that differs in one way */
async function editDatabase(bytes: Uint8Array, statement: string) {
  const engine = await loadNodeSqlEngine()
  const database = new engine.Database(bytes)
  database.run(statement)
  const edited = new Uint8Array(database.export())
  database.close()
  return edited
}

describe('reading Actual Budget files', () => {
  it('reads an export zip with its budget name, budget type and live rows', async () => {
    const budget = await readBudget(new File([readActualFixture('envelope', 'export.zip')], 'export.zip'))
    const manifest = readActualManifest('envelope')

    expect(budget.budgetName).toBe('Lumina Check Envelope')
    expect(budget.budgetType).toBe('envelope')
    expect(budget.currencyCode).toBeNull()
    expect(budget.budgetDecimals).toBe(2)
    expect(budget.accounts.map((account) => account.name).sort())
      .toEqual(manifest.accounts.map((account) => account.name).sort())
    expect(budget.accounts.find((account) => account.name === 'Old Joint Checking')?.closed).toBe(true)
    expect(budget.accounts.filter((account) => account.offBudget).map((account) => account.name).sort())
      .toEqual(['Brokerage', 'Car Loan'])

    // Split parents stand in for their children, so only the rows that carry amounts are counted
    const amountRows = budget.transactions.filter((transaction) => !transaction.isParent)
    expect(amountRows).toHaveLength(manifest.rows.length + manifest.afterAsOf.length)
    expect(budget.transactions.some((transaction) => transaction.notes === 'Entered twice by mistake')).toBe(false)
  })

  it('resolves merged payees and categories to the ones the merges kept', async () => {
    const budget = await readBudget(new File([readActualFixture('envelope', 'export.zip')], 'export.zip'))
    const payeeName = new Map(budget.payees.map((payee) => [payee.id, payee.name]))
    const categoryName = new Map(budget.categories.map((category) => [category.id, category.name]))

    expect(budget.payees.some((payee) => payee.name === 'LOBLAWS #1234')).toBe(false)
    expect(budget.categories.some((category) => category.name === 'Eating Out')).toBe(false)
    const cafeRows = budget.transactions.filter((transaction) => payeeName.get(transaction.payeeId ?? '') === 'Café Olé')
    expect(new Set(cafeRows.map((transaction) => categoryName.get(transaction.categoryId ?? '')))).not.toContain(undefined)
    expect(budget.categories.find((category) => category.name === 'Old Hobby')?.hidden).toBe(true)
  })

  it('reads only the figures of the budget type that is switched on', async () => {
    const budget = await readBudget(new File([readActualFixture('envelope', 'export.zip')], 'export.zip'))
    const manifest = readActualManifest('envelope')
    const categoryName = new Map(budget.categories.map((category) => [category.id, category.name]))

    const read = budget.budgetFigures
      .filter((figure) => figure.amount !== 0 || figure.carryover)
      .map((figure) => `${figure.month} ${categoryName.get(figure.categoryId)} ${(figure.amount / 100).toFixed(2)} ${figure.carryover}`)
      .sort()
    const expected = manifest.budgets
      .map((figure) => `${figure.month} ${figure.category} ${figure.budgeted} ${figure.carryover}`)
      .sort()
    expect(read).toEqual(expected)

    // The stale tracking figures of 999.00 never surface
    expect(budget.budgetFigures.some((figure) => figure.amount === 99900)).toBe(false)
  })

  it('reads deleted accounts, merges and hidden groups the way Actual shows them', async () => {
    const budget = await readBudget(new File([readActualFixture('edges', 'export.zip')], 'export.zip'))
    const manifest = readActualManifest('edges')
    const accountName = new Map(budget.accounts.map((account) => [account.id, account.name]))
    const category = new Map(budget.categories.map((category) => [category.id, category]))

    expect(budget.accounts.map((account) => account.name).sort()).toEqual(manifest.accounts.map((account) => account.name).sort())
    expect(budget.accounts.find((account) => account.name === 'Wallet')?.closed).toBe(true)
    expect(budget.transactions.filter((transaction) => !transaction.isParent)).toHaveLength(manifest.rows.length)

    // Rows kept in a deleted account go with it, and Actual blanks the payee of the other side of a
    // transfer to one, which then reads as an ordinary row
    expect(budget.transactions.map((transaction) => accountName.get(transaction.accountId))).not.toContain(undefined)
    const toDeleted = budget.transactions.filter((transaction) => ['2026-07-06', '2026-07-07'].includes(transaction.date))
    expect(toDeleted.map((transaction) => [transaction.amount, transaction.payeeId, transaction.transferredId, category.get(transaction.categoryId ?? '')?.name ?? null]))
      .toEqual([[-12000, null, null, null], [-10000, null, null, 'Car']])

    // Treats was merged into Snacks, which was then deleted, so its row reads uncategorized
    const treats = budget.transactions.find((transaction) => transaction.date === '2026-07-11')
    expect(treats?.categoryId).toBeNull()
    expect(budget.categories.some((category) => ['Snacks', 'Treats'].includes(category.name))).toBe(false)

    expect(budget.categories.filter((category) => category.name === 'Travel').map((category) => category.groupName).sort()).toEqual(['Away', 'Home'])
    expect(budget.categories.find((category) => category.name === 'Gym')).toMatchObject({ groupName: 'Retired', hidden: true })
    expect(budget.budgetFigures.filter((figure) => figure.amount !== 0)
      .map((figure) => `${figure.month} ${category.get(figure.categoryId)?.groupName}/${category.get(figure.categoryId)?.name} ${figure.amount / 100}`)
      .sort())
      .toEqual(manifest.budgets.map((figure) => `${figure.month} ${figure.categoryGroup}/${figure.category} ${Number(figure.budgeted)}`).sort())
  })

  it('reads a bare yen db.sqlite, keeping transactions in hundredths and budgets in whole yen', async () => {
    const budget = await readBudget(new File([readActualFixture('yen', 'db.sqlite')], 'db.sqlite'))
    const manifest = readActualManifest('yen')

    expect(budget.budgetName).toBeNull()
    expect(budget.budgetType).toBe('tracking')
    expect(budget.currencyCode).toBe('JPY')
    expect(budget.budgetDecimals).toBe(0)

    const lawson = budget.transactions.find((transaction) => transaction.date === '2026-07-10')
    expect(lawson?.amount).toBe(-458000)
    const food = budget.categories.find((category) => category.name === 'Food')
    expect(budget.budgetFigures.filter((figure) => figure.categoryId === food?.id).map((figure) => [figure.month, figure.amount]))
      .toEqual([['2026-07', 30000], ['2026-08', 30000]])
    expect(budget.transactions.filter((transaction) => !transaction.isParent)).toHaveLength(manifest.rows.length)
  })

  it('reads a bare database the same as the zip that holds it', async () => {
    const zip = readActualFixture('yen', 'export.zip')
    const fromZip = await readBudget(new File([zip], 'export.zip'))
    const fromBare = await readBudget(new File([unzipActualDatabase(zip)], 'db.sqlite'))

    expect(fromBare.transactions).toEqual(fromZip.transactions)
    expect(fromBare.budgetFigures).toEqual(fromZip.budgetFigures)
  })

  it('finds the database inside one folder of the zip', async () => {
    const database = unzipActualDatabase(readActualFixture('yen', 'export.zip'))
    const zip = zipSync({ 'My Budget/db.sqlite': database })

    const budget = await readBudget(new File([zip], 'export.zip'))
    expect(budget.currencyCode).toBe('JPY')
  })

  it('refuses a zip whose listing unpacks past the cap before inflating it', async () => {
    const zip = zipSync({ 'db.sqlite': new Uint8Array(16) })

    // The central directory's uncompressed size, which the listing reports, sits 24 bytes into its entry
    const directory = zip.findLastIndex((_, index) => zip[index] === 0x50 && zip[index + 1] === 0x4b && zip[index + 2] === 0x01 && zip[index + 3] === 0x02)
    new DataView(zip.buffer).setUint32(directory + 24, 0xfffffff0, true)

    expect(await readRefusal(new File([zip], 'export.zip'))).toMatch(/unpacks to over 250 MB/)
  })

  it('refuses a bare database over the cap without reading it', async () => {
    const file = new File([readActualFixture('yen', 'db.sqlite').subarray(0, 64)], 'db.sqlite')
    Object.defineProperty(file, 'size', { value: MAX_ACTUAL_DATABASE_BYTES + 1 })

    expect(await readRefusal(file)).toMatch(/over 250 MB/)
  })

  it.each([
    ['a CSV export', new File(['Date,Amount\n2026-01-01,5\n'], 'transactions.csv')],
    ['a zip without a budget', new File([zipSync({ 'notes.txt': new Uint8Array([1]) })], 'export.zip')],
  ])('refuses %s as not an Actual Budget file', async (_, file) => {
    expect(await readRefusal(file)).toMatch(/Actual Budget|Export data/)
  })

  it('names the table a database is missing, with its Actual version', async () => {
    const database = await editDatabase(readActualFixture('yen', 'db.sqlite'), 'DROP TABLE category_mapping')

    expect(await readRefusal(new File([database], 'db.sqlite')))
      .toMatch(/version 1787013118115\) has no category_mapping table/)
  })

  it('names a view a database is missing', async () => {
    const database = await editDatabase(readActualFixture('yen', 'db.sqlite'), 'DROP VIEW v_transactions')

    expect(await readRefusal(new File([database], 'db.sqlite'))).toMatch(/has no v_transactions view/)
  })

  it('refuses a budget with a date or an amount Actual would not have written', async () => {
    const database = await editDatabase(
      unzipActualDatabase(readActualFixture('envelope', 'export.zip')),
      `UPDATE transactions SET date = 2026 WHERE id = (SELECT id FROM v_transactions WHERE account IS NOT NULL ORDER BY id LIMIT 1);
       UPDATE transactions SET amount = 12.5 WHERE id = (SELECT id FROM v_transactions WHERE account IS NOT NULL ORDER BY id DESC LIMIT 1)`,
    )

    expect(await readRefusal(new File([database], 'db.sqlite'))).toMatch(/^This budget has 2 transactions whose date or amount isn't stored/)
  })

  it('refuses a budget with a date no calendar has', async () => {
    for (const date of [20261399, 20260231, 101]) {
      const database = await editDatabase(
        unzipActualDatabase(readActualFixture('envelope', 'export.zip')),
        `UPDATE transactions SET date = ${date} WHERE id = (SELECT id FROM v_transactions WHERE account IS NOT NULL ORDER BY id LIMIT 1)`,
      )

      expect(await readRefusal(new File([database], 'db.sqlite')), String(date)).toMatch(/^This budget has 1 transaction whose date or amount/)
    }
  })

  it('reads a yen budget the same way whichever Actual version wrote it', async () => {
    const expected = await readBudget(new File([readActualFixture('yen', 'db.sqlite')], 'db.sqlite'))
    for (const statement of ['INSERT INTO __migrations__ (id) VALUES (9999999999999)', 'DELETE FROM __migrations__']) {
      const database = await editDatabase(readActualFixture('yen', 'db.sqlite'), statement)
      const budget = await readBudget(new File([database], 'db.sqlite'))

      expect({ ...budget, databaseVersion: null }, statement).toEqual({ ...expected, databaseVersion: null })
    }
  })

  it('hides a category that is visible itself but sits in a hidden group', async () => {
    const database = await editDatabase(
      unzipActualDatabase(readActualFixture('edges', 'export.zip')),
      "UPDATE categories SET hidden = 0 WHERE name = 'Gym'",
    )

    const budget = await readBudget(new File([database], 'db.sqlite'))
    expect(budget.categories.find((category) => category.name === 'Gym')).toMatchObject({ groupName: 'Retired', hidden: true })
  })

  it('reads budget figures under their own category, since a merge already added them to the one it kept', async () => {
    const bytes = unzipActualDatabase(readActualFixture('envelope', 'export.zip'))
    const merged = await editDatabase(bytes, `
      INSERT INTO zero_budgets (id, month, category, amount, carryover)
      SELECT '202607-' || cm.id, 202607, cm.id, 12345, 0
      FROM category_mapping cm JOIN categories c ON c.id = cm.id JOIN categories kept ON kept.id = cm.transferId AND kept.tombstone = 0
      WHERE c.tombstone = 1 AND cm.transferId <> cm.id
    `)

    const original = await readBudget(new File([bytes], 'db.sqlite'))
    const edited = await readBudget(new File([merged], 'db.sqlite'))
    expect(await countRows(merged, "SELECT COUNT(*) FROM zero_budgets WHERE id LIKE '202607-%'")).toBeGreaterThan(0)
    expect(edited.budgetFigures).toEqual(original.budgetFigures)
  })
})
