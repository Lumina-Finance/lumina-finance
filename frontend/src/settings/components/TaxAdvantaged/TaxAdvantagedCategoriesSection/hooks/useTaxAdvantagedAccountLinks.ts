import { useMemo, useState } from 'react'
import { useUpdateAccount, type AccountsOverview } from '@/api/accounts'
import type { TaxAdvantagedCategory } from '@/api/taxAdvantagedCategories'
import type { AutosaveNotice } from '@/settings/components/TaxAdvantaged/taxAdvantagedTypes'
import {
  ACCOUNT_LINK_SAVE_MIN_LOADING_MS,
  ACCOUNT_LINK_SAVE_NOTICE_DELAY_MS,
} from '@/settings/components/TaxAdvantaged/TaxAdvantagedCategoriesSection/taxAdvantagedCategoryConstants'
import { delay } from '@/settings/components/TaxAdvantaged/TaxAdvantagedCategoriesSection/taxAdvantagedCategoryUtils'

interface UseTaxAdvantagedAccountLinksParams {
  accounts: AccountsOverview[]
  plan: TaxAdvantagedCategory
  showAutosaveNotice: (notice: AutosaveNotice) => void
}

/**
 * Owns TAC account eligibility, link mutations, and account-link feedback
 */
export function useTaxAdvantagedAccountLinks({
  accounts,
  plan,
  showAutosaveNotice,
}: UseTaxAdvantagedAccountLinksParams) {
  const updateAccount = useUpdateAccount()
  const [accountError, setAccountError] = useState<string | null>(null)
  const bindableAccounts = useMemo(
    () => accounts.filter(
      (account) =>
        account.closed_at === null
        && account.account_kind === 'asset'
        && account.currency === plan.currency,
    ),
    [accounts, plan.currency],
  )
  const linkedAccountsCount = bindableAccounts.filter((account) => account.tax_advantaged_category_id === plan.id).length
  const linkedAccountsSummary = `${linkedAccountsCount} linked`
  const linkedAccountsMobileSummary = `${linkedAccountsCount} ${linkedAccountsCount === 1 ? 'acct' : 'accts'} linked`
  const pendingAccountId = updateAccount.isPending
    ? updateAccount.variables?.accountId ?? null
    : null

  /**
   * Toggles a same-currency asset account link while preserving minimum autosave feedback timing
   */
  async function toggleAccount(account: AccountsOverview) {
    if (account.is_archived) return

    const isLinked = account.tax_advantaged_category_id === plan.id
    let savingNoticeShown = false
    const savingNoticeTimer = window.setTimeout(() => {
      savingNoticeShown = true
      showAutosaveNotice({ status: 'saving', message: 'Saving account link...' })
    }, ACCOUNT_LINK_SAVE_NOTICE_DELAY_MS)

    try {
      await updateAccount.mutateAsync({
        accountId: account.id,
        payload: { tax_advantaged_category_id: isLinked ? null : plan.id },
      })
      window.clearTimeout(savingNoticeTimer)

      if (savingNoticeShown) await delay(ACCOUNT_LINK_SAVE_MIN_LOADING_MS)

      setAccountError(null)
      showAutosaveNotice({ status: 'saved', message: 'Account link saved.' })
    } catch (error) {
      window.clearTimeout(savingNoticeTimer)
      const message = error instanceof Error ? error.message : 'Failed to update account binding.'
      setAccountError(message)
      showAutosaveNotice({ status: 'error', message })
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
