import type { AccountsOverview } from '@/api/accounts'
import type { BankLink } from '@/api/bank-sync'
import type { Transaction } from '@/api/transactions'
import { isSymmetricTransferForm } from '@/components/transactions/transaction-modal/utils/validation'
import type { TransactionFormValues } from '@/components/transactions/transaction-modal/types'
import { formatDateLabel } from '@/utils/date'

type SupplyingLink = Pick<BankLink, 'provider_name' | 'import_start'>

// A linked account the save would write into, named when the message has to say which account it means
type SuppliedAccount = {
  link: SupplyingLink
  accountName: string | null
}

export type SuppliedDays = {
  /** Days the calendar refuses, absent when the save writes into no linked account */
  isDateDisabled: ((iso: string) => boolean) | undefined

  /** Why the calendar refuses a day, worded for the account that supplies it, null for a day it allows */
  getDateDisabledReason: ((iso: string) => string | null) | undefined

  /** Why the form's date can't be saved, null when it can */
  message: string | null
}

/** A save that writes into no linked account, or one that brings in a bank item, any day can take */
export const NO_SUPPLIED_DAYS: SuppliedDays = {
  isDateDisabled: undefined,
  getDateDisabledReason: undefined,
  message: null,
}

type GetSuppliedDaysOptions = {
  form: TransactionFormValues

  /** The stored transaction an edit starts from, absent when creating */
  transaction?: Pick<Transaction, 'account_id' | 'dt' | 'bank_source'>

  /** The account the form records the transaction in, named when a new pair writes into two */
  recordedAccount: Pick<AccountsOverview, 'name'> | undefined

  /** The account chosen as the other side of a transfer, absent when it is outside the app or not chosen */
  counterpartyAccount: Pick<AccountsOverview, 'id' | 'name'> | undefined
  linksByAccount: ReadonlyMap<string, SupplyingLink>

  /** Today in the user's profile timezone, as YYYY-MM-DD */
  today: string
}

function isSuppliedDay(date: string, link: SupplyingLink, today: string): boolean {
  return date >= link.import_start && date <= today
}

/**
 * Works out which days the form can't date a transaction on, because a linked account's bank
 * supplies that account's transactions from its import start through today
 *
 * Mirrors the backend's refusal, so the date is refused before a save rather than by it. A
 * bank-imported transaction in a linked account answers to that account's link instead: its date is
 * the bank's to correct, and moving it elsewhere is refused on the account field for the move itself,
 * so it is checked only once it moves out of an account no longer linked. An edit is checked only when its date
 * or account changes, since one that keeps both writes no new day. A new symmetric transfer writes a
 * second transaction into the other account, so that account's days count too, and with two accounts
 * in play the message names the one it means
 */
export function getSuppliedDays({
  form,
  transaction,
  recordedAccount,
  counterpartyAccount,
  linksByAccount,
  today,
}: GetSuppliedDaysOptions): SuppliedDays {
  const moved = transaction !== undefined && form.account_id !== transaction.account_id
  const accounts: SuppliedAccount[] = []

  // Only a new pair writes into the other account, since an edit changes the one transaction alone
  const isNewPair = !transaction && isSymmetricTransferForm(form)

  // Checked first, so a day both accounts' banks supply is described as the recorded account's
  const recordedLink = linksByAccount.get(form.account_id)
  const isUnderItsLink = transaction?.bank_source != null && linksByAccount.has(transaction.account_id)
  if (recordedLink && !isUnderItsLink) {
    accounts.push({ link: recordedLink, accountName: isNewPair ? (recordedAccount?.name ?? null) : null })
  }

  const counterpartyLink = counterpartyAccount && linksByAccount.get(counterpartyAccount.id)
  if (counterpartyLink && isNewPair) accounts.push({ link: counterpartyLink, accountName: counterpartyAccount.name })

  if (accounts.length === 0) return NO_SUPPLIED_DAYS

  const isUnchanged = transaction !== undefined && !moved && form.date === transaction.dt
  const findSupplying = (iso: string) => accounts.find(({ link }) => isSuppliedDay(iso, link, today))
  const supplying = isUnchanged ? undefined : findSupplying(form.date)
  return {
    isDateDisabled: (iso) => findSupplying(iso) !== undefined,
    getDateDisabledReason: (iso) => {
      const day = findSupplying(iso)
      return day ? describeSuppliedDays(day) : null
    },
    message: supplying ? describeSuppliedDays(supplying) : null,
  }
}

/**
 * Words the refusal, with the date's spaces unbreakable so a narrow field never leaves its month on
 * one line and its day on the next
 */
function describeSuppliedDays({ link, accountName }: SuppliedAccount): string {
  const transactions = accountName ? `the transactions in ${accountName}` : "this account's transactions"
  const start = formatDateLabel(link.import_start).replaceAll(' ', ' ')
  return `${link.provider_name} supplies ${transactions} from ${start} to today`
}
