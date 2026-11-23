/**
 * What holds back Add to ledger on a bank item, the review form's submit
 *
 * An item on an account the server keeps read-only can be dismissed but not added, so its account's reason
 * holds the submit back before a refusal from an earlier press, and the submit runs nothing. Dismiss is not
 * the submit, so it stays open
 *
 * @param reviewAccount The bank item's account, when the form reviews one
 * @param refusalReason What a refused earlier press found missing, if anything
 * @param formReadOnly Whether the form is read-only for another reason
 * @returns The reason the footer shows on Add to ledger, and whether the submit runs nothing
 */
export function getReviewSubmitHold(
  reviewAccount: { read_only_reason?: string | null } | undefined,
  refusalReason: string | undefined,
  formReadOnly: boolean,
): { submitBlockedReason: string | undefined; submitReadOnly: boolean } {
  const readOnlyReason = reviewAccount?.read_only_reason || undefined
  return {
    submitBlockedReason: readOnlyReason ?? refusalReason,
    submitReadOnly: formReadOnly || readOnlyReason !== undefined,
  }
}
