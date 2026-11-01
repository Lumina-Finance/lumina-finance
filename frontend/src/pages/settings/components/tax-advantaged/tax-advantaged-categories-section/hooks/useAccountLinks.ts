import { useMemo, useState } from 'react'
import { useUpdateAccount, type AccountsOverview } from '@/api/accounts'
import type { TaxAdvantagedCategory } from '@/api/tax-advantaged-categories'
import { useToast } from '@/hooks/useToast'
import {
  ACCOUNT_LINK_SAVE_MIN_LOADING_MS,
  ACCOUNT_LINK_SAVE_NOTICE_DELAY_MS,
} from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/constants'
import { waitForMilliseconds } from '@/utils/timing'

interface UseTaxAdvantagedAccountLinksParams {
  accounts: AccountsOverview[]
  plan: TaxAdvantagedCategory
}

/**
 * Owns TAC account eligibility, link mutations, and account-link feedback
 */
export function useTaxAdvantagedAccountLinks({ accounts, plan }: UseTaxAdvantagedAccountLinksParams) {
  const { showToast, dismissToast } = useToast()
  const updateAccount = useUpdateAccount()
  const [accountError, setAccountError] = useState<string | null>(null)
  const bindableAccounts = useMemo(
    () => accounts.filter((account) => account.account_kind === 'asset' && account.currency === plan.currency),
    [accounts, plan.currency],
  )
  const linkedAccountsCount = bindableAccounts.filter(
    (account) => account.tax_advantaged_category_id === plan.id,
  ).length
  const linkedAccountsSummary = `${linkedAccountsCount} linked`
  const linkedAccountsMobileSummary = `${linkedAccountsCount} ${linkedAccountsCount === 1 ? 'acct' : 'accts'} linked`
  const pendingAccountId = updateAccount.isPending ? (updateAccount.variables?.accountId ?? null) : null

  /**
   * Toggles a same-currency asset account link while preserving minimum autosave feedback timing
   */
  async function toggleAccount(account: AccountsOverview) {
    if (account.is_archived) return

    const isLinked = account.tax_advantaged_category_id === plan.id
    let savingNoticeShown = false
    const savingNoticeTimer = window.setTimeout(() => {
      savingNoticeShown = true
      showToast({ status: 'saving', text: 'Saving account link...' })
    }, ACCOUNT_LINK_SAVE_NOTICE_DELAY_MS)

    try {
      await updateAccount.mutateAsync({
        accountId: account.id,
        payload: { tax_advantaged_category_id: isLinked ? null : plan.id },
      })
      window.clearTimeout(savingNoticeTimer)

      if (savingNoticeShown) await waitForMilliseconds(ACCOUNT_LINK_SAVE_MIN_LOADING_MS)

      setAccountError(null)
      showToast({ status: 'success', text: 'Account link saved.' })
    } catch (error) {
      window.clearTimeout(savingNoticeTimer)
      // The failure shows once, in the dialogue, so a progress message still up gives way to it
      if (savingNoticeShown) dismissToast()
      setAccountError(error instanceof Error ? error.message : 'Failed to update account binding.')
    }
  }

  return {
    accountError,
    bindableAccounts,
    linkedAccountsCount,
    linkedAccountsMobileSummary,
    linkedAccountsSummary,
    pendingAccountId,
    toggleAccount,
  }
}
