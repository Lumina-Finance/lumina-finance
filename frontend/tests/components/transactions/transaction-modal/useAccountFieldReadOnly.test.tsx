/**
 * Guards the transaction form's account fields for an account the server keeps read-only. The Account
 * dropdown leaves such an account out, so a transaction already on one is supplied as its own option, as an
 * archived one is, rather than reading as unanswered. Ticking the paired transfer clears a read-only
 * counterparty, since the matching transaction it writes would be refused there
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import { useAccountField } from '@/components/transactions/transaction-modal/hooks/useAccountField'
import type { TransactionFormValues } from '@/components/transactions/transaction-modal/types'
import { createAccount } from '@tests/components/transactions/transaction-modal/utils/fixtures'

const READ_ONLY = 'Records in USD are read-only. They can be archived or deleted'
const CHEQUING = createAccount({ id: 'chequing', name: 'Chequing' })
const SAVINGS = createAccount({ id: 'savings', name: 'Savings' })
const US_CARD = createAccount({ id: 'us-card', name: 'US card', currency: 'USD', read_only_reason: READ_ONLY })
const ACCOUNTS: AccountsOverview[] = [CHEQUING, SAVINGS, US_CARD]

type FieldState = ReturnType<typeof useAccountField>

/**
 * Runs the hook once on a form holding `accountId` and `counterpartyId`, then ticks the paired transfer
 * when asked. Returns what the hook gave and the form the tick left
 */
function runHook(
  accountId: string,
  counterpartyId: string,
  { editing = true, tick = false } = {},
): { state: FieldState; form: TransactionFormValues } {
  const form = {
    account_id: accountId,
    counterparty_account_id: counterpartyId,
    symmetric_transfer: false,
    currency: 'CAD',
  } as unknown as TransactionFormValues
  let next = form
  let state: FieldState | undefined
  function HookProbe() {
    state = useAccountField({
      accounts: ACCOUNTS,
      counterpartyAccounts: ACCOUNTS,
      selectableAccounts: [CHEQUING, SAVINGS],
      editing,
      selectedAccount: ACCOUNTS.find((account) => account.id === accountId),
      form,
      setForm: (update) => {
        next = typeof update === 'function' ? update(form) : update
      },
      clearSubmitError: () => {},
      tagById: new Map(),
    })
    if (tick) state.handleSymmetricTransferChange(true)
    return null
  }
  renderToStaticMarkup(<HookProbe />)
  if (!state) throw new Error('The hook did not run')
  return { state, form: next }
}

describe('the account fields of a transaction on a read-only account', () => {
  it("supplies the transaction's own read-only account as its option while editing", () => {
    expect(runHook('us-card', '').state.selectedArchivedAccountOption).toEqual({ value: 'us-card', label: 'US card' })
  })

  it('supplies no extra option for an account that takes writes, or for a new transaction', () => {
    expect(runHook('chequing', '').state.selectedArchivedAccountOption).toBeUndefined()
    expect(runHook('us-card', '', { editing: false }).state.selectedArchivedAccountOption).toBeUndefined()
  })

  it('clears a read-only counterparty once the paired transfer is ticked, and keeps one that takes writes', () => {
    expect(runHook('chequing', 'us-card', { tick: true }).form.counterparty_account_id).toBe('')
    expect(runHook('chequing', 'savings', { tick: true }).form.counterparty_account_id).toBe('savings')
  })
})
