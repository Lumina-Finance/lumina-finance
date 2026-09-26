/**
 * Turns the upload the import screen sent into the fixture the backend test replays, with every
 * id replaced by the name it stood for, since the ids belong to the user this run signed up
 */
import type { LuminaSnapshot } from './compare.ts'
import type { FireflyManifest, FireflyRunInfo, ManifestRow } from './manifest.ts'

export interface CapturedUpload {
  method: string
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

interface StageBody {
  accounts: AccountMapping[]
  categories: CategoryMapping[]
  rows: unknown[]
  start_row_index: number
}

interface BudgetsBody {
  categories: CategoryMapping[]
  budgets: unknown[]
}

interface ArchiveBody {
  account_sources: string[]
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

  // A category matched to one the user already has is named, and one the import creates is kept
  const nameCategories = (categories: CategoryMapping[]) => categories.map(({ category_id, ...mapping }) => (
    category_id ? { ...mapping, category_name: categoryName(category_id) } : mapping
  ))

  const transactions = uploads
    .filter((upload) => upload.method === 'POST' && upload.path.endsWith('/firefly/rows'))
    .map(({ body }) => {
      const { accounts, categories, rows, start_row_index } = body as StageBody

      // A new user has no accounts or institutions of their own, so every account is created
      for (const account of accounts) {
        if (account.account_id || account.create?.institution_id) throw new Error(`The upload maps ${account.source} to an existing record`)
      }
      return { accounts, categories: nameCategories(categories), rows, start_row_index }
    })

  // The screen sends the budgets once, and not at all when none is imported
  const budgetUploads = uploads.filter((upload) => upload.method === 'PUT' && upload.path.endsWith('/budgets'))
  if (budgetUploads.length > 1) throw new Error(`The screen sent the budgets ${budgetUploads.length} times`)
  const budgetsBody = budgetUploads[0]?.body as BudgetsBody | undefined
  const budgets = budgetsBody ? { categories: nameCategories(budgetsBody.categories), budgets: budgetsBody.budgets } : null

  // The accounts to archive are sent once, and not at all when the import archives none
  const archiveUploads = uploads.filter((upload) => upload.method === 'PUT' && upload.path.endsWith('/archive'))
  if (archiveUploads.length > 1) throw new Error(`The screen sent the accounts to archive ${archiveUploads.length} times`)
  const archive = (archiveUploads[0]?.body as ArchiveBody | undefined)?.account_sources ?? null

  return {
    firefly: runInfo,
    transactions,
    budgets,
    archive,

    // What Firefly III reported, for the test to hold the replayed import to
    expected: {
      accounts: manifest.accounts.map(({ name, type, currency, balance, active }) => ({ name, type, currency, balance, active })),
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
