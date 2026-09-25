import { isFireflyTrackedAccountType } from '@/api/firefly-imports'
import type { FireflyAccountSource, FireflyAccountSources } from '@/pages/imports/firefly/types'

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
