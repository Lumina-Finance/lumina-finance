import type { Database, SqlJsStatic, SqlValue } from 'sql.js'
import {
  ACTUAL_DATABASE_FILE_NAME,
  ACTUAL_FILE_GUIDANCE,
  ACTUAL_METADATA_FILE_NAME,
  ACTUAL_NEWEST_CHECKED_MIGRATION,
  ACTUAL_REQUIRED_COLUMNS,
  ACTUAL_TRANSACTION_DECIMALS,
  ACTUAL_ZERO_DECIMAL_CURRENCIES,
  MAX_ACTUAL_DATABASE_BYTES,
  MAX_ACTUAL_UNPACKED_BYTES,
  MAX_ACTUAL_ZIP_BYTES,
} from '@/pages/imports/actual/constants'
import type {
  ActualAccount,
  ActualBudgetFigure,
  ActualBudgetFile,
  ActualBudgetType,
  ActualCategory,
  ActualFileRead,
  ActualPayee,
  ActualTransaction,
} from '@/pages/imports/actual/types'

/** Starts the SQLite engine, which the browser and the tests each locate their own way */
export type SqlEngineLoader = () => Promise<SqlJsStatic>

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]
const SQLITE_SIGNATURE = 'SQLite format 3\0'
const NOT_ACTUAL_REASON = `This isn't an Actual Budget file. ${ACTUAL_FILE_GUIDANCE}`
const MIB = 1024 * 1024

// Actual renamed its budget types, and a file that never switched keeps no preference at all
const BUDGET_TYPES: Record<string, ActualBudgetType> = {
  envelope: 'envelope',
  rollover: 'envelope',
  tracking: 'tracking',
  report: 'tracking',
}

/**
 * Loads sql.js with its wasm served from this app's own build, only when an Actual file is read
 */
export const loadBrowserSqlEngine: SqlEngineLoader = async () => {
  const [{ default: initSqlJs }, { default: wasmUrl }] = await Promise.all([
    import('sql.js'),
    import('sql.js/dist/sql-wasm.wasm?url'),
  ])
  return initSqlJs({ locateFile: () => wasmUrl })
}

/**
 * Reads an Actual Budget export zip or bare db.sqlite into the budget it holds
 *
 * Only live rows are read, the way Actual's screens show them: deleted rows are skipped, payees and
 * categories Actual merged resolve to the one the merge kept, and deleted ones read as blank. Amounts stay the integers Actual stored, since which scale
 * they are in depends on the currency chosen later
 *
 * @param file - The uploaded file, never sent anywhere
 * @param loadSqlEngine - Starts sql.js
 */
export async function readActualBudgetFile(
  file: File,
  loadSqlEngine: SqlEngineLoader = loadBrowserSqlEngine,
): Promise<ActualFileRead> {
  const bytes = new Uint8Array(await file.slice(0, SQLITE_SIGNATURE.length).arrayBuffer())

  if (startsWithZipSignature(bytes)) {
    if (file.size > MAX_ACTUAL_ZIP_BYTES) return refuse(`The zip is over ${MAX_ACTUAL_ZIP_BYTES / MIB} MB, which is more than the import opens.`)
    const unpacked = await unpackActualZip(new Uint8Array(await file.arrayBuffer()))
    if ('reason' in unpacked) return refuse(unpacked.reason)
    return readActualDatabase(unpacked.database, unpacked.budgetName, loadSqlEngine)
  }

  if (new TextDecoder().decode(bytes) === SQLITE_SIGNATURE) {
    if (file.size > MAX_ACTUAL_DATABASE_BYTES) {
      return refuse(`The file is over ${MAX_ACTUAL_DATABASE_BYTES / MIB} MB, which is more than the import opens.`)
    }
    return readActualDatabase(new Uint8Array(await file.arrayBuffer()), null, loadSqlEngine)
  }

  return refuse(NOT_ACTUAL_REASON)
}

class ZipTooLargeError extends Error {}

function refuse(reason: string): ActualFileRead {
  return { status: 'refused', reason }
}

function startsWithZipSignature(bytes: Uint8Array) {
  return ZIP_SIGNATURE.every((byte, index) => bytes[index] === byte)
}

/**
 * Takes the database and budget name out of an export zip, which holds them at its top or inside
 * one folder. Sizes come from the zip's listing, so an oversized entry is refused before inflating
 */
async function unpackActualZip(zip: Uint8Array): Promise<{ database: Uint8Array; budgetName: string | null } | { reason: string }> {
  const { unzipSync } = await import('fflate')
  let declaredTotal = 0
  let entries: Record<string, Uint8Array>
  try {
    // The filter sees each entry's listed size before that entry is inflated, so throwing here
    // stops a zip bomb before any of it is unpacked
    entries = unzipSync(zip, {
      filter: (entry) => {
        declaredTotal += entry.originalSize
        if (declaredTotal > MAX_ACTUAL_UNPACKED_BYTES) throw new ZipTooLargeError()
        return isActualZipEntry(entry.name, ACTUAL_DATABASE_FILE_NAME) || isActualZipEntry(entry.name, ACTUAL_METADATA_FILE_NAME)
      },
    })
  } catch (error) {
    if (error instanceof ZipTooLargeError) {
      return { reason: `The zip unpacks to over ${MAX_ACTUAL_UNPACKED_BYTES / MIB} MB, which is more than the import opens.` }
    }
    return { reason: `The zip can't be opened. ${ACTUAL_FILE_GUIDANCE}` }
  }

  const databases = Object.keys(entries).filter((name) => isActualZipEntry(name, ACTUAL_DATABASE_FILE_NAME))
  if (databases.length !== 1) return { reason: `The zip doesn't hold one Actual Budget ${ACTUAL_DATABASE_FILE_NAME}. ${ACTUAL_FILE_GUIDANCE}` }
  const database = entries[databases[0]]
  if (database.length > MAX_ACTUAL_DATABASE_BYTES) {
    return { reason: `The budget inside the zip is over ${MAX_ACTUAL_DATABASE_BYTES / MIB} MB, which is more than the import opens.` }
  }

  const metadataName = Object.keys(entries).find((name) => isActualZipEntry(name, ACTUAL_METADATA_FILE_NAME))
  return { database, budgetName: metadataName ? readBudgetName(entries[metadataName]) : null }
}

/** Whether a zip entry is the named file at the zip's top or directly inside one folder */
function isActualZipEntry(entryName: string, fileName: string) {
  const parts = entryName.split('/')
  return parts[parts.length - 1] === fileName && parts.length <= 2
}

function readBudgetName(metadata: Uint8Array) {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(metadata))
    const name = typeof parsed === 'object' && parsed !== null ? (parsed as { budgetName?: unknown }).budgetName : null
    return typeof name === 'string' && name.trim() ? name.trim() : null
  } catch {
    return null
  }
}

async function readActualDatabase(
  bytes: Uint8Array,
  budgetName: string | null,
  loadSqlEngine: SqlEngineLoader,
): Promise<ActualFileRead> {
  const engine = await loadSqlEngine()
  let database: Database
  try {
    database = new engine.Database(bytes)
  } catch {
    return refuse(NOT_ACTUAL_REASON)
  }

  try {
    const databaseVersion = readDatabaseVersion(database)
    const missing = findMissingColumns(database)
    if (missing) {
      const version = databaseVersion === null ? '' : ` (Actual database version ${databaseVersion})`
      return refuse(`This Actual Budget file${version} has no ${missing}, which the import reads. ${ACTUAL_FILE_GUIDANCE}`)
    }

    const preferences = readPreferences(database)
    const currencyCode = preferences.get('flags.currency') === 'true'
      ? preferences.get('defaultCurrencyCode')?.trim().toUpperCase() || null
      : null
    const budgetDecimals = currencyCode && ACTUAL_ZERO_DECIMAL_CURRENCIES.has(currencyCode) ? 0 : 2
    if (budgetDecimals === 0 && (databaseVersion === null || databaseVersion > ACTUAL_NEWEST_CHECKED_MIGRATION)) {
      return refuse(
        `This budget is in ${currencyCode}, and it comes from a newer version of Actual than the import has been `
        + 'checked against. Amounts in currencies without decimal places could be read at the wrong size, so it '
        + "can't be imported yet.",
      )
    }

    const transactions = readTransactions(database)

    // Actual writes every date as YYYYMMDD and every amount as a whole number of hundredths, so a row
    // that isn't was written by something else, and no reading of it can be trusted
    const malformed = transactions.filter((transaction) => !transaction.date || !Number.isSafeInteger(transaction.amount)).length
    if (malformed > 0) {
      return refuse(
        `This budget has ${malformed.toLocaleString()} ${malformed === 1 ? 'transaction' : 'transactions'} whose date or amount `
        + "isn't stored the way Actual stores them, so it can't be imported.",
      )
    }

    // Actual writes every transaction in hundredths, so a zero-decimal budget whose amounts are not
    // all whole hundreds was written some other way, and reading it either way could be 100 times off
    const hundredths = 10 ** ACTUAL_TRANSACTION_DECIMALS
    if (budgetDecimals === 0 && transactions.some((transaction) => transaction.amount % hundredths !== 0)) {
      return refuse(
        `This budget is in ${currencyCode}, and some of its amounts aren't stored the way the import expects `
        + "for a currency without decimal places, so it can't be imported.",
      )
    }

    const budgetType = BUDGET_TYPES[preferences.get('budgetType') ?? 'envelope'] ?? 'envelope'
    const budget: ActualBudgetFile = {
      budgetName,
      databaseVersion,
      budgetType,
      currencyCode,
      budgetDecimals,
      accounts: readAccounts(database),
      payees: readPayees(database),
      categories: readCategories(database),
      transactions,
      budgetFigures: readBudgetFigures(database, budgetType),
    }
    return { status: 'read', budget }
  } catch {
    return refuse(NOT_ACTUAL_REASON)
  } finally {
    database.close()
  }
}

function selectRows(database: Database, sql: string): Record<string, SqlValue>[] {
  const [result] = database.exec(sql)
  if (!result) return []
  return result.values.map((values) => Object.fromEntries(result.columns.map((column, index) => [column, values[index]])))
}

function readDatabaseVersion(database: Database) {
  try {
    const [row] = selectRows(database, 'SELECT MAX(id) AS id FROM __migrations__')
    return typeof row?.id === 'number' ? row.id : null
  } catch {
    return null
  }
}

/** Names the first table, view or column the reader needs and the file lacks, or null */
function findMissingColumns(database: Database) {
  for (const [table, columns] of Object.entries(ACTUAL_REQUIRED_COLUMNS)) {
    const present = new Set(selectRows(database, `PRAGMA table_info(${table})`).map((row) => String(row.name)))
    if (present.size === 0) return `${table} ${table.startsWith('v_') ? 'view' : 'table'}`
    const missing = columns.find((column) => !present.has(column))
    if (missing) return `${table}.${missing} column`
  }
  return null
}

function readPreferences(database: Database) {
  return new Map(selectRows(database, 'SELECT id, value FROM preferences').map((row) => [String(row.id), row.value === null ? '' : String(row.value)]))
}

const text = (value: SqlValue) => (value === null || value === undefined ? null : String(value))
const flag = (value: SqlValue) => value === 1 || value === '1'

function readAccounts(database: Database): ActualAccount[] {
  return selectRows(database, 'SELECT id, name, offbudget, closed, type FROM accounts WHERE tombstone = 0 ORDER BY sort_order, name')
    .map((row) => ({
      id: String(row.id),
      name: text(row.name)?.trim() ?? '',
      offBudget: flag(row.offbudget),
      closed: flag(row.closed),
      type: text(row.type)?.trim() || null,
    }))
}

function readPayees(database: Database): ActualPayee[] {
  return selectRows(database, 'SELECT id, name, transfer_acct FROM v_payees WHERE tombstone = 0')
    .map((row) => ({
      id: String(row.id),
      name: text(row.name)?.trim() ?? '',
      transferAccountId: text(row.transfer_acct),
    }))
}

function readCategories(database: Database): ActualCategory[] {
  return selectRows(database, `
    SELECT c.id, c.name, c.is_income, c.hidden, g.name AS group_name, g.hidden AS group_hidden
    FROM v_categories c
    LEFT JOIN category_groups g ON g.id = c."group"
    WHERE c.tombstone = 0
  `).map((row) => ({
    id: String(row.id),
    name: text(row.name)?.trim() ?? '',
    groupName: text(row.group_name)?.trim() || null,
    isIncome: flag(row.is_income),
    hidden: flag(row.hidden) || flag(row.group_hidden),
  }))
}

/**
 * Reads live transactions in live accounts through Actual's own view. Deleting an account in Actual
 * also blanks the payee and transfer link on the other side of each transfer to it, so those rows
 * read as the ordinary rows Actual then shows
 */
function readTransactions(database: Database): ActualTransaction[] {
  return selectRows(database, `
    SELECT id, account, amount, notes, date, is_parent, parent_id, transfer_id, starting_balance_flag,
      payee, category
    FROM v_transactions
    WHERE account IS NOT NULL
    ORDER BY date, sort_order DESC, id
  `).map((row) => ({
    id: String(row.id),
    accountId: String(row.account),
    date: formatActualDate(row.date),
    amount: typeof row.amount === 'number' ? row.amount : Number.NaN,
    payeeId: text(row.payee),
    categoryId: text(row.category),
    notes: text(row.notes),
    isParent: flag(row.is_parent),
    parentId: text(row.parent_id),
    transferredId: text(row.transfer_id),
    isStartingBalance: flag(row.starting_balance_flag),
  }))
}

/**
 * Reads the figures of the budget type the file has on, for live categories. A file keeps both
 * tables, and the one switched off holds whatever was typed before the last switch
 *
 * Each figure is read under its own category, unlike rows. Merging a category into another adds
 * its figures to the other's own and leaves them behind under the deleted one, so following the
 * merge would count them twice
 */
function readBudgetFigures(database: Database, budgetType: ActualBudgetType): ActualBudgetFigure[] {
  const table = budgetType === 'tracking' ? 'reflect_budgets' : 'zero_budgets'
  return selectRows(database, `
    SELECT b.month, c.id AS category, b.amount, b.carryover
    FROM ${table} b
    JOIN v_categories c ON c.id = b.category AND c.tombstone = 0
    ORDER BY b.month
  `).map((row) => ({
    month: formatActualMonth(row.month),
    categoryId: String(row.category),
    amount: typeof row.amount === 'number' ? row.amount : 0,
    carryover: flag(row.carryover),
  }))
}

/** Actual stores dates as YYYYMMDD integers. Anything else reads as an empty date, which the reader refuses */
function formatActualDate(value: SqlValue) {
  const digits = String(value ?? '')
  return /^\d{8}$/.test(digits) ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}` : ''
}

function formatActualMonth(value: SqlValue) {
  const digits = String(value ?? '')
  return /^\d{6}$/.test(digits) ? `${digits.slice(0, 4)}-${digits.slice(4)}` : ''
}
