/**
 * The Actual API the seed drives, and the facts it reads from the installed Actual packages
 *
 * Actual's public API has no way to create a budget with chosen settings or to break one side of a
 * transfer, so the seed calls a few of Actual's internal handlers. Each goes through `callHandler`,
 * so a later release that renames or reshapes one stops the seed with the handler's name rather
 * than seeding something else
 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import * as api from '@actual-app/api'
import type { ActualMigration } from '../manifest.ts'

export { api }

type Send = (name: string, args?: unknown) => Promise<unknown>

// Where npm puts the packages, beside the seed, since Node's import ignores NODE_PATH
const PACKAGES_DIR = join(import.meta.dirname, 'node_modules', '@actual-app')

// Actual's own currency table and its list of feature flags, in the core package's shipped source
const CURRENCIES_SOURCE = join(PACKAGES_DIR, 'core', 'src', 'shared', 'currencies.ts')
const PREFERENCES_SOURCE = join(PACKAGES_DIR, 'core', 'src', 'types', 'prefs.ts')

// The migrations the API applies to every budget it opens, one file per database version
const MIGRATIONS_DIR = join(PACKAGES_DIR, 'api', 'dist', 'migrations')

export class ActualSession {
  private readonly send: Send

  private constructor(send: Send) {
    this.send = send
  }

  /**
   * Signs in to the server with the session token its bootstrap gave, keeping the local copies of
   * the budgets in a folder of the caller's choosing
   */
  static async open(serverURL: string, sessionToken: string, dataDir: string) {
    const { send } = await api.init({ serverURL, sessionToken, dataDir })
    return new ActualSession(send as Send)
  }

  /**
   * Creates a budget on the server and opens it. Actual ignores a failed upload here, so the
   * server's own list is checked for the new budget before anything is written into it
   */
  async createBudget(budgetName: string) {
    // Actual's own import closes the open budget first too, since opening another restarts its services
    await this.callHandler('close-budget', undefined)
    await this.callHandler('create-budget', { budgetName })
    const budgets = await api.getBudgets() as { name: string; groupId?: string; state?: string }[]
    const created = budgets.find((budget) => budget.name === budgetName && budget.groupId)
    if (!created) throw new Error(`Actual created ${budgetName} but never uploaded it to the server`)
  }

  /** Saves one of the budget's synced preferences, and checks Actual kept it */
  async savePreference(id: string, value: string) {
    await this.callHandler('preferences/save', { id, value })
    const saved = (await api.getPreferences() as Record<string, unknown>)[id]
    if (String(saved) !== value) throw new Error(`Actual kept ${id} as ${String(saved)} rather than ${value}`)
  }

  /**
   * Clears one side's link to the other side of its transfer, keeping its transfer payee, so the
   * transfer is linked one way only. Transfers are left alone while doing it, since otherwise
   * Actual would make the side a fresh counterpart
   */
  async unlinkTransferSide(id: string) {
    await this.callHandler('transactions-batch-update', { updated: [{ id, transfer_id: null }], runTransfers: false })
  }

  private async callHandler(name: string, args: unknown) {
    let result: unknown
    try {
      result = await this.send(name, args)
    } catch (error) {
      throw new Error(`Actual's ${name} handler failed, so this release may have renamed or changed it: ${String(error)}`)
    }
    if (result && typeof result === 'object' && 'error' in result && result.error) {
      throw new Error(`Actual's ${name} handler answered ${JSON.stringify(result.error)}`)
    }
    return result
  }
}

/** Reads the installed API's version, which is the version it writes budgets as */
export async function readApiVersion() {
  const packageJson = JSON.parse(await readFile(join(PACKAGES_DIR, 'api', 'package.json'), 'utf8')) as { version: string }
  return packageJson.version
}

/** Every migration the installed API applies, oldest first, named by the file it comes from */
export async function readMigrations(): Promise<ActualMigration[]> {
  const files = await readdir(MIGRATIONS_DIR)
  const migrations = files
    .map((file) => ({ file, match: file.match(/^(\d+)_/) }))
    .filter((entry): entry is { file: string; match: RegExpMatchArray } => entry.match !== null)
    .map(({ file, match }) => ({ id: Number(match[1]), file }))
    .sort((a, b) => a.id - b.id)
  if (migrations.length === 0) throw new Error(`No migrations found in ${MIGRATIONS_DIR}`)
  return migrations
}

/** Decimal places Actual's own currency table gives each currency */
export async function readCurrencyDecimals(): Promise<Map<string, number>> {
  const source = await readFile(CURRENCIES_SOURCE, 'utf8')
  const decimals = new Map<string, number>()
  for (const match of source.matchAll(/\{\s*code:\s*'([A-Z]{3})'[^}]*?decimalPlaces:\s*(\d+)/g)) {
    decimals.set(match[1], Number(match[2]))
  }

  // A reshaped table must stop the seed, since reading none would report no zero-decimal currency
  if (decimals.size < 10 || !decimals.has('USD')) throw new Error(`Actual's currency table in ${CURRENCIES_SOURCE} could not be read`)
  return decimals
}

/** Whether currency is still one of Actual's feature flags, which is what the importer reads */
export async function isCurrencyFeatureFlag() {
  const source = await readFile(PREFERENCES_SOURCE, 'utf8')
  const flags = source.match(/export type FeatureFlag =([^;]*);/)
  if (!flags) throw new Error(`Actual's feature flags in ${PREFERENCES_SOURCE} could not be read`)
  return /'currency'/.test(flags[1])
}
