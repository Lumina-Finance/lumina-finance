import type { AccountType } from '@/api/accounts'
import { ACCOUNT_TYPE_OPTIONS } from './constants'

/**
 * Checks whether a raw import selection matches one of the account types the backend accepts
 */
export function isImportAccountType(value: string): value is AccountType {
  return ACCOUNT_TYPE_OPTIONS.some((option) => option.value === value)
}
