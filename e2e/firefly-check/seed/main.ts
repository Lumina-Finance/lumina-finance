/**
 * Seeds a fresh Firefly III with the check's dataset, downloads its exports and writes the manifest
 *
 * Run by seed.sh inside the compose network, with the API token it creates in the container
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FireflyRunInfo } from '../manifest.ts'
import { ACCOUNTS, BUDGETS, DATASET_START, buildGroups, type SeedSplit } from './dataset.ts'
import { FireflyClient, type FireflyResource } from './firefly.ts'
import { recordManifest } from './record.ts'

const firefly = new FireflyClient(requireEnv('FIREFLY_URL'), requireEnv('FIREFLY_TOKEN'))
const outputDir = process.env.OUTPUT_DIR ?? join(import.meta.dirname, '..', 'output')

for (const code of ['EUR', 'USD', 'JPY']) {
  await firefly.call('POST', `/currencies/${code}/enable`)
}

const accountIds = new Map<string, string>()
for (const account of ACCOUNTS) {
  const created = await firefly.call<{ data: FireflyResource<unknown> }>('POST', '/accounts', { name: account.name, ...account.body })
  accountIds.set(account.name, created.data.id)
}

const budgetIds = new Map<string, string>()
for (const budget of BUDGETS) {
  const created = await firefly.call<{ data: FireflyResource<unknown> }>('POST', '/budgets', { name: budget.name, active: true })
  budgetIds.set(budget.name, created.data.id)
  for (const limit of budget.limits) {
    await firefly.call('POST', `/budgets/${created.data.id}/limits`, {
      start: limit.start,
      end: limit.end,
      amount: limit.amount,
      currency_code: limit.currency,
    })
  }
}

for (const group of buildGroups()) {
  await firefly.call('POST', '/transactions', {
    error_if_duplicate_hash: false,
    apply_rules: false,
    fire_webhooks: false,
    ...(group.title ? { group_title: group.title } : {}),
    transactions: group.splits.map(toFireflySplit),
  })
}

// Firefly III takes no new rows on an inactive account, so these close only once their rows are in
for (const account of ACCOUNTS.filter((entry) => entry.deactivate)) {
  await firefly.call('PUT', `/accounts/${accountIds.get(account.name)}`, { name: account.name, active: false })
}
for (const budget of BUDGETS.filter((entry) => entry.deactivate)) {
  await firefly.call('PUT', `/budgets/${budgetIds.get(budget.name)}`, { name: budget.name, active: false })
}

// The web export runs from the chosen start to today, which is what a person moving over has
const exportEnd = new Date().toISOString().slice(0, 10)
await mkdir(outputDir, { recursive: true })
const exports: [string, string][] = [
  ['transactions', `/data/export/transactions?type=csv&start=${DATASET_START}&end=${exportEnd}`],
  ['budgets', '/data/export/budgets?type=csv'],
  ['accounts', '/data/export/accounts?type=csv'],
]
for (const [name, path] of exports) {
  await writeFile(join(outputDir, `${name}.csv`), await firefly.download(path))
}

const about = await firefly.call<{ data: { version: string } }>('GET', '/about')
const runInfo: FireflyRunInfo = { fireflyVersion: about.data.version, exportEnd }
await writeFile(join(outputDir, 'run.json'), `${JSON.stringify(runInfo, null, 2)}\n`)
await writeFile(join(outputDir, 'manifest.json'), `${JSON.stringify(await recordManifest(firefly), null, 2)}\n`)
console.log(`Seeded Firefly III ${runInfo.fireflyVersion}; exports and manifest are in ${outputDir}`)

function toFireflySplit(split: SeedSplit) {
  return {
    type: split.type,
    date: split.date,
    amount: split.amount,
    description: split.description,
    ...(split.source ? { source_id: requireAccount(split.source) } : { source_name: split.sourceName }),
    ...(split.destination ? { destination_id: requireAccount(split.destination) } : { destination_name: split.destinationName }),
    ...(split.category ? { category_name: split.category } : {}),
    ...(split.budget ? { budget_name: split.budget } : {}),
    ...(split.tags ? { tags: split.tags } : {}),
    ...(split.notes ? { notes: split.notes } : {}),
    ...(split.foreignAmount ? { foreign_amount: split.foreignAmount, foreign_currency_code: split.foreignCurrency } : {}),
  }
}

function requireAccount(name: string) {
  const id = accountIds.get(name)
  if (!id) throw new Error(`The dataset names an account it never creates: ${name}`)
  return id
}

function requireEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}
