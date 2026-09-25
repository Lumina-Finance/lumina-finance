/**
 * Turns the upload the import screen sent into the fixture the backend test replays, with every
 * id replaced by the name it stood for, since the ids belong to the user this run signed up
 */
import type { LuminaSnapshot } from './compare.ts'
import type { FireflyManifest, FireflyRunInfo, ManifestRow } from './manifest.ts'

export interface CapturedUpload {
  path: string
  body: unknown
}

interface CategoryMapping {
  source: string
  category_id?: string
  create?: unknown
}

interface AccountMapping {
  source: string
  account_id?: string
  create?: { institution_id?: string | null }
}

interface TransactionsBody {
  accounts: AccountMapping[]
  categories: CategoryMapping[]
  rows: unknown[]
}

interface BudgetsBody {
  budgets: { category_ids: string[] }[]
}

export function buildUploadFixture(
  uploads: CapturedUpload[],
  lumina: LuminaSnapshot,
  manifest: FireflyManifest,
  runInfo: FireflyRunInfo,
) {
  const categoryName = (id: string) => {
    const name = lumina.categories.find((category) => category.id === id)?.name
    if (!name) throw new Error(`The upload names a category the user does not have: ${id}`)
    return name
  }

  const transactions = uploads
    .filter((upload) => upload.path === '/transactions/import/firefly')
    .map(({ body }) => {
      const { accounts, categories, rows } = body as TransactionsBody

      // A new user has no accounts or institutions of their own, so every account is created
      for (const account of accounts) {
        if (account.account_id || account.create?.institution_id) throw new Error(`The upload maps ${account.source} to an existing record`)
      }
      return {
        accounts,
        categories: categories.map(({ category_id, ...mapping }) => (
          category_id ? { ...mapping, category_name: categoryName(category_id) } : mapping
        )),
        rows,
      }
    })

  const budgets = uploads
    .filter((upload) => upload.path === '/transactions/import/firefly/budgets')
    .flatMap(({ body }) => (body as BudgetsBody).budgets)
    .map(({ category_ids, ...budget }) => ({ ...budget, category_names: category_ids.map(categoryName) }))

  return {
    firefly: runInfo,
    transactions,
    budgets,

    // What Firefly III reported, for the test to hold the replayed import to
    expected: {
      accounts: manifest.accounts.map(({ name, currency, balance }) => ({ name, currency, balance })),
      categoryMonths: manifest.categoryMonths,
      budgets: manifest.budgets.map(({ name, active, limits }) => ({
        name,
        active,
        limits,

        // A budget tracks the Firefly III categories of the spending filed under it
        categories: [...new Set(manifest.rows
          .filter((row) => row.budget === name && row.category && row.date <= runInfo.exportEnd && isPayeeRow(row))
          .map((row) => row.category))].sort(),
      })),
    },
  }
}

/** A withdrawal from, or deposit into, an imported account whose other side is outside */
function isPayeeRow(row: ManifestRow) {
  return (row.type === 'withdrawal' && row.source.imported && !row.destination.imported)
    || (row.type === 'deposit' && row.destination.imported && !row.source.imported)
}
