import type { AccountsOverview } from '@/api/accounts'
import { CREATE_ACCOUNT_VALUE } from '@/pages/imports/constants'
import type { ImportAccountSource } from '@/pages/imports/types'
import { inferAccountMappings } from '@/pages/imports/utils/accountMapping'

interface ResolveFireflyAccountMappingsOptions {
  sources: ImportAccountSource[]
  liveMappings: Record<string, string>
  selectableAccounts: AccountsOverview[]
  accountsCurrent: boolean
}

/** Resolves Firefly account answers from stored choices, name matches and create defaults */
export function resolveFireflyAccountMappings(
  options: ResolveFireflyAccountMappingsOptions,
): Record<string, string> {
  const inferred = inferAccountMappings(options.sources, options.liveMappings, {
    rowAccounts: options.selectableAccounts,
    counterpartyAccounts: options.selectableAccounts,
  })

  if (!options.accountsCurrent) return inferred

  for (const source of options.sources) {
    if (!inferred[source.id]) inferred[source.id] = CREATE_ACCOUNT_VALUE
  }

  return inferred
}
