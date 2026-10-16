import { ImportNotice } from '@/pages/imports/components'
import { OfxReveal } from '@/pages/imports/ofx/components/OfxReveal'

/**
 * Danger notice on the account step listing each statement whose currency is not its account's,
 * or nothing while every statement is going to an account in its own currency
 */
export function OfxCurrencyMismatchNotice({ mismatches }: { mismatches: string[] }) {
  return (
    <OfxReveal show={mismatches.length > 0}>
      <ImportNotice title="Statements in another currency" tone="danger" items={mismatches}>
        A transaction takes the currency of its account, so these statements can't be imported as chosen:
      </ImportNotice>
    </OfxReveal>
  )
}
