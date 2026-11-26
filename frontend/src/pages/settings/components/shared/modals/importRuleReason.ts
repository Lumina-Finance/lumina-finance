/**
 * How the server words a refused delete when an import rule is what uses the merchant, category or tag.
 * The backend tests pin that sentence for each of the three, since this match depends on it
 */
const IMPORT_RULE_REASON = /^(Merchant|Category|Tag) is used by the import rule "/

const RULE_TITLE = 'Choose a replacement first'
const RULE_NO_REPLACEMENT_REASON = 'Nothing compatible to take its place'

/**
 * Words a "choose another, then delete" dialogue for a delete the server refused because an import rule
 * uses the record, or says nothing when the refusal is for anything else
 *
 * The server's own sentence says which rule is in the way, so it leads the dialogue. The way forward
 * follows it, and the title and the empty-list reason stop saying the transactions move, since they don't
 *
 * @param reason - The 409's message, or null where the dialogue wasn't opened by one
 * @param noun - The record's kind in lower case, as in "merchant"
 * @returns The wording that differs from the transactions case, empty where the reason isn't a rule's
 */
export function getImportRuleWording(reason: string | null, noun: 'merchant' | 'category' | 'tag') {
  if (!reason || !IMPORT_RULE_REASON.test(reason)) return {}

  return {
    title: RULE_TITLE,
    noReplacementReason: RULE_NO_REPLACEMENT_REASON,
    description: `${reason}. Please choose another ${noun} to take its place, then you can delete it.`,
  }
}
