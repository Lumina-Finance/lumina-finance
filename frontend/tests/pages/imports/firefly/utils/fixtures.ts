import type { Currency } from '@/api/currency'
import { isFireflyTrackedAccountType } from '@/api/firefly-imports'
import { CREATE_ACCOUNT_VALUE, CREATE_CATEGORY_VALUE } from '@/pages/imports/constants'
import type { FireflyAccountSource, FireflyAccountSources } from '@/pages/imports/firefly/types'
import {
  buildFireflyAccountPrefills,
  buildFireflyCategoryKinds,
  buildFireflyImportPayload,
  getFireflyAccountSources,
  getFireflyImportedCategories,
  type FireflyRowResolutionOptions,
} from '@/pages/imports/firefly/utils'
import type { CsvRow, ImportFileDraft } from '@/pages/imports/types'

/**
 * Account sources keyed by name, for tests about anything other than telling same-named accounts
 * apart, so their mappings can be written by account name
 *
 * Every endpoint with a tracked type resolves by its name alone, and the listed names are the
 * accounts the mapping step would ask about. It stands in for getFireflyAccountSources, so a test
 * built on it does not cover which endpoints the import counts as accounts, and every listed account
 * reads as an asset account, so it cannot stand in for a liability's prefill either
 */
export function createNameKeyedAccountSources(names: string[] = []): FireflyAccountSources {
  const toSource = (name: string): FireflyAccountSource => ({ id: name, name, type: 'Asset account', label: name })

  return {
    list: names.map(toSource),
    find: (name, type) => {
      const trimmedName = name?.trim() ?? ''
      return trimmedName && isFireflyTrackedAccountType(type) ? toSource(trimmedName) : null
    },
  }
}

/**
 * Stages the import the way the steps do for a user with nothing yet, where every account and
 * category is created new
 */
export function stageFireflyImportAsNew(transactionsFile: ImportFileDraft, rows: CsvRow[], currencies: Currency[]) {
  const accountSources = getFireflyAccountSources(rows)
  const prefills = buildFireflyAccountPrefills(rows, accountSources, new Set(currencies.map((currency) => currency.id)))
  const importedCategories = getFireflyImportedCategories(rows)
  const categoryCreateKinds = buildFireflyCategoryKinds(rows)
  const options: FireflyRowResolutionOptions = {
    accountSources,
    accountById: new Map(),
    accountMappings: Object.fromEntries(accountSources.list.map((source) => [source.id, CREATE_ACCOUNT_VALUE])),
    accountCreateDetails: Object.fromEntries(accountSources.list.map((source) => [
      source.id,
      { ...prefills[source.id], institutionId: '' },
    ])),
    institutionById: new Map(),
    categoryById: new Map(),
    categoryMappings: Object.fromEntries(importedCategories.map((source) => [source, CREATE_CATEGORY_VALUE])),
    categoryCreateKinds,
    transferCategory: undefined,
    balanceAdjustmentCategory: undefined,
    currencies,
  }
  const { payload, errors } = buildFireflyImportPayload({ transactionsFile, rows, importedCategories, ...options })
  if (!payload) throw new Error(`The staged import builds no payload: ${errors.join('; ')}`)
  return { options, importedCategories, payload }
}
