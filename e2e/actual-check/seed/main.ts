/**
 * Seeds each of the check's budgets into a fresh Actual server, exports each through Actual's own
 * export, and writes the manifests and run details beside the exports
 *
 * Run by seed.sh inside the compose network, with the session token the server's bootstrap gave
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ActualRunInfo } from '../manifest.ts'
import { ActualSession, api, isCurrencyFeatureFlag, readApiVersion, readCurrencyDecimals } from './actual.ts'
import { DATASETS, RunDates } from './dataset.ts'
import { crossCheckBudgetMonths, recordManifest } from './record.ts'

const outputDir = process.env.OUTPUT_DIR ?? join(import.meta.dirname, '..', 'output')
const timezone = requireEnv('TZ')

// The run date where the person importing lives, which the import screen also reads today from
const asOf = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
const dates = new RunDates(asOf)

const currencyDecimals = await readCurrencyDecimals()

// Actual keeps its own copy of each budget here while seeding it, which nothing reads afterwards
const dataDir = await mkdtemp(join(tmpdir(), 'actual-seed-'))
const session = await ActualSession.open(requireEnv('ACTUAL_URL'), requireEnv('ACTUAL_SESSION_TOKEN'), dataDir)

await rm(outputDir, { recursive: true, force: true })
for (const dataset of DATASETS) {
  await session.createBudget(dataset.budgetName)
  if (dataset.currency) {
    await session.savePreference('flags.currency', 'true')
    await session.savePreference('defaultCurrencyCode', dataset.currency)
  }
  const seeded = await dataset.seed({ api, session, dates })
  await api.sync()

  const budgetDir = join(outputDir, dataset.name)
  await mkdir(budgetDir, { recursive: true })
  const exportZip = await api.exportBudget()
  await writeFile(join(budgetDir, 'export.zip'), exportZip)
  const manifest = await recordManifest(api, { budget: dataset.name, asOf, exportZip, seeded, currencyDecimals })
  await writeFile(join(budgetDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await crossCheckBudgetMonths(api, dataset.name, seeded.figures)
  console.log(`Seeded ${dataset.name}: ${manifest.accounts.length} accounts, ${manifest.figures.length} figures`)
}

const version = await api.getServerVersion()
if (!('version' in version)) throw new Error(`The Actual server gave no version: ${JSON.stringify(version)}`)
await api.shutdown()
await rm(dataDir, { recursive: true, force: true })

const runInfo: ActualRunInfo = {
  actualVersion: version.version,
  apiVersion: await readApiVersion(),
  asOf,
  timezone,
  budgets: DATASETS.map((dataset) => dataset.name),
  importer: {
    zeroDecimalCurrencies: requireEnv('ACTUAL_ZERO_DECIMAL_CURRENCIES').split(',').sort(),
  },
  actual: {
    zeroDecimalCurrencies: [...currencyDecimals].filter(([, decimals]) => decimals === 0).map(([code]) => code).sort(),
    currencyIsFeatureFlag: await isCurrencyFeatureFlag(),
  },
}
await writeFile(join(outputDir, 'run.json'), `${JSON.stringify(runInfo, null, 2)}\n`)
console.log(`Seeded Actual ${runInfo.actualVersion} with API ${runInfo.apiVersion} as of ${asOf}; exports and manifests are in ${outputDir}`)

function requireEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}
