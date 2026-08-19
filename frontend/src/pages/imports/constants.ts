import type { CSSProperties } from 'react'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { DropdownOption } from '@/components/dropdown/Dropdown'
import type { ColumnMap, ColumnTarget, ColumnTargetGroup, ImportAmountDirection, ImportCategoryKind } from './types'
import type { ImportDateFormat } from './utils/valueParsers'

export const EMPTY_COLUMN_MAP: ColumnMap = {
  account_id: '',
  dt: '',
  category_id: '',
  amount: '',
  amount_out: '',
  amount_in: '',
  amount_direction: '',
  currency: '',
  merchant_id: '',
  notes: '',
  tag_ids: '',
  counterparty_account_id: '',
}

export const COLUMN_TARGETS: Array<{
  id: ColumnTarget
  label: string
  hint: string
  group: ColumnTargetGroup
}> = [
  { id: 'account_id', label: 'Account', hint: 'Resolved from the source account when the file contains one.', group: 'optional' },

  // Straight after the account it belongs beside, and before every target that scores on values
  // alone, since those would otherwise claim a column of account names first
  {
    id: 'counterparty_account_id',
    label: 'Counterparty account',
    hint: 'Specifies which account a transfer\'s money went to, or came from, without writing a transaction into that account. Only transfer rows can use it, and a blank cell records the transfer as going outside this app.',
    group: 'optional',
  },
  { id: 'dt', label: 'Date', hint: 'Transaction date.', group: 'required' },
  { id: 'category_id', label: 'Category', hint: 'Resolved from imported category text.', group: 'required' },

  // The three ways a file can carry the amount, one arrangement of which every import needs. The two
  // sides follow the single column they are an alternative to
  { id: 'amount', label: 'Amount', hint: 'One column carrying the whole transaction, negative for money out and positive for money in. Map this, or map the two sides below where the file writes them separately. An unsigned column belongs here too when a Direction column specifies whether each row is money in or money out.', group: 'amount' },
  { id: 'amount_out', label: 'Money out', hint: 'A column holding only the money leaving the account, written either unsigned or with a minus sign. A plus sign there is refused, since money coming in belongs in the Money in column. Map it beside Money in, or on its own where the file holds nothing but money going out.', group: 'amount' },
  { id: 'amount_in', label: 'Money in', hint: 'A column holding only the money coming into the account, written either unsigned or with a plus sign. A minus sign there is refused, since money going out belongs in the Money out column. Map it beside Money out, or on its own where the file holds nothing but money coming in.', group: 'amount' },

  // Declared after the three fields carrying money so those pick their columns first while the file
  // is being read. Where it sits in the dropdown is settled by its group instead, which is why it
  // has a separate one rather than sitting among the optional fields
  { id: 'amount_direction', label: 'Direction', hint: 'A column of words specifying whether each row is money in or money out, such as DEBIT and CREDIT. Map it beside an Amount column of unsigned amounts, then specify below the table what each word means. It holds two words, or one where the file only covers money moving one way.', group: 'direction' },
  { id: 'currency', label: 'Currency', hint: 'ISO currency code. Checked against the account each row is written to.', group: 'optional' },
  { id: 'merchant_id', label: 'Merchant', hint: 'Resolved from imported merchant text.', group: 'optional' },
  { id: 'notes', label: 'Notes', hint: 'Optional transaction notes.', group: 'optional' },
  { id: 'tag_ids', label: 'Tags', hint: 'Resolved from imported tag text.', group: 'optional' },
]

// What the mapping dropdown heads each group with, and the order the groups run in. The dropdown
// starts a new heading every time the group changes going down the list, so the targets have to
// arrive sorted by this or a group reached twice is headed twice
export const COLUMN_TARGET_GROUP_LABELS: Record<ColumnTargetGroup, string> = {
  required: 'Required fields',
  // Says the group is required and that one entry is enough to answer it, since it sits below a
  // group headed Required fields and would otherwise read as optional. It cannot repeat the Amount
  // label either, which is the first entry underneath it
  amount: 'Required, at least one of these',
  // Heads its one field rather than letting it sit among the optional ones, since it is optional
  // only in the sense that most files do not need it, and useless without the field above it
  direction: 'Optional, beside a single Amount column',
  optional: 'Optional fields',
}
export const COLUMN_TARGET_GROUP_RANKS: Record<ColumnTargetGroup, number> = {
  required: 0,
  amount: 1,
  direction: 2,
  optional: 3,
}

// Reported as missing where no field carrying the amount is mapped. It offers all three rather than
// the single column, since a two-sided file sent to a field called Amount imports every purchase as
// money coming in. The Direction column is left out, since it carries no money and mapping it
// answers nothing here. No comma in it, because two callers join the missing labels with one and a
// label carrying its own would read as two columns
export const MISSING_AMOUNT_COLUMN_LABEL = 'Amount (or Money out / Money in)'

// Said where a file is mapped as carrying its amount both ways at once, which states it twice with
// nothing to say which reading wins. Shown on the mapping step beside the dropdowns that caused it,
// as well as over the commit button, since the mapping step is where it can be answered
export const AMOUNT_ARRANGEMENT_CLASH_TITLE = 'Amount mapped twice'
export const AMOUNT_ARRANGEMENT_CLASH_ERROR = 'This file is mapped with an Amount column and with a Money out or Money in column. Map one or the other: a single Amount column carrying its own sign, or the two sides in columns of their own.'

// Said where a file is mapped with a Direction column beside Money out or Money in, which specifies
// the direction twice over. A Direction column only means anything beside the single Amount column,
// since the two sides already carry their own direction
export const DIRECTION_ARRANGEMENT_CLASH_TITLE = 'Direction stated twice'
export const DIRECTION_ARRANGEMENT_CLASH_ERROR = 'This file is mapped with a Direction column and with a Money out or Money in column. Money out and Money in already specify their own direction, so either map the Direction column beside a single Amount column, or set it to Do not import.'

// Shown above the panel where each word in the Direction column is given its meaning. It settles
// whose point of view the two answers take, which is the one thing the panel cannot show: a bank
// writes DEBIT and CREDIT from its own side, and the user is answering from theirs. That a
// recognised word arrives filled in is left to the glow on the row, which is how every other field
// the app filled in says so
export const DIRECTION_VALUES_TITLE = 'What this file\'s direction words mean'
export const DIRECTION_VALUES_EXPLANATION = 'Specify what each word in the Direction column means. Money out is money leaving your account, money in is money arriving in it.'

// How many different words a Direction column may hold. Two, because it separates money in from
// money out and does nothing else: a column naming more things than that is a category, a payment
// method or a description, and answering it value by value would become a second category step
export const MAX_DIRECTION_COLUMN_VALUES = 2

/**
 * Says a column mapped as the Direction holds more words than two directions need
 *
 * The count is given because it is what rules the column out, and there is no answer inside the app:
 * either this is not the column separating money in from money out, or the file has to be corrected
 * before it is uploaded
 */
export function getTooManyDirectionValuesError(count: number) {
  return `This column has ${count.toLocaleString()} different values. A Direction column holds at most ${MAX_DIRECTION_COLUMN_VALUES}, one for money out and one for money in.`
}

/**
 * Says which words in the Direction column have not been answered yet
 *
 * The words are spelled out because the panel shows them as the file writes them, and a message
 * saying only that something is unanswered leaves the user hunting for which
 */
export function getUnansweredDirectionValuesError(values: string[]) {
  const isOne = values.length === 1
  return `Specify what ${values.join(' and ')} ${isOne ? 'means' : 'mean'} in the Direction column above.`
}

/**
 * Says both words in the Direction column were given the same meaning
 *
 * Refused rather than imported, because the two answers cannot distinguish a file that really does
 * hold money moving one way only from one whose words were answered the wrong way round, and
 * importing the second silently commits a month of income as spending
 *
 * Both ways out are offered, because the one-directional file is real. It does not need this column
 * at all: mapping its Amount column as the single side it holds is the arrangement built for it.
 * Offering only the flip would have the user correct a right answer into a wrong one
 */
export function getDirectionValuesAgreeError(direction: 'out' | 'in') {
  const label = direction === 'out' ? 'Money out' : 'Money in'
  return `Both words in the Direction column are set to ${label}, so nothing in this file separates the two directions. If every row really is ${label.toLowerCase()}, map the Amount column as ${label} and set the Direction column to Do not import. Otherwise set one of the two words to the other direction.`
}

// The merchant an imported row is filed under when its file states no payee, and the one a transfer
// row gets, since a transfer has no payee of its own. Both ship with the app, and these have to stay
// in step with the backend's own names, the way the balance adjustment category name does
export const UNKNOWN_MERCHANT_NAME = 'Unknown'
export const SELF_MERCHANT_NAME = 'Myself'

// The two answers the merchant step offers beside the merchants themselves, kept distinct from any
// merchant id. Creating is what a value gets when nothing matches it, and skipping files that
// value's rows under the shared merchant a row stating no payee gets
export const CREATE_MERCHANT_VALUE = '__create_merchant__'
export const SKIP_MERCHANT_VALUE = '__skip_merchant__'

// What one row may carry, matching what the API accepts. Checked here so an offending row is named
// against its row number in the preview rather than failing part-way through the upload
export const MAX_IMPORT_NOTES_LENGTH = 10_000
export const MAX_IMPORT_TAGS_PER_ROW = 32

// Distinct account or category values one import may declare, matching what the API accepts across
// a whole run rather than per request, so splitting the batches differently cannot get past it
export const MAX_IMPORT_MAPPINGS = 1_000

/**
 * Says an import declares more distinct values for a column than one import may carry
 *
 * Counted across every staged file, since they are committed together as one import. The way out
 * depends on which case it is, so the wording covers both: stage fewer files, or split the one file
 * that carries them all
 */
export function getTooManyMappingsError(kind: 'account' | 'category', count: number) {
  return `This import has ${count.toLocaleString()} different ${kind} values, and one import carries up to ${MAX_IMPORT_MAPPINGS.toLocaleString()}. Split the data into smaller imports.`
}

/**
 * Says a value queued as a new category carries a name the user already has, recording the other
 * direction, which the commit refuses because one name records one direction
 */
export function getCategoryDirectionClashError(source: string, existingName: string, existingKind: Category['kind']) {
  const direction = KIND_LABELS[existingKind].toLowerCase()
  return `${existingName} already records ${direction}, so ${source} cannot be created. Match it to that category, or set its type to ${direction}.`
}

/**
 * Says a row's notes are longer than the importer stores
 */
export function getRowNotesTooLongReason(length: number) {
  return `The notes are ${length.toLocaleString()} characters, and the importer stores up to ${MAX_IMPORT_NOTES_LENGTH.toLocaleString()}.`
}

/**
 * Says a row names more tags than one transaction may carry
 */
export function getRowTooManyTagsReason(count: number) {
  return `This row has ${count} tags, and a transaction carries up to ${MAX_IMPORT_TAGS_PER_ROW}.`
}

// Shown in the column mapping step where any row states no payee, which is every row when no column
// is mapped as the Merchant and only the blank ones where a column is. It asks for nothing: every
// transaction carries a merchant, so those rows are filed under one that ships with the app, and
// this says so before the import runs rather than leaving it to be noticed in the preview
export const ROWS_WITH_NO_PAYEE_TITLE = 'Rows with no payee'

/**
 * Says what will happen to the rows stating no payee, with them counted
 *
 * No merchant is stated, because which one a row gets depends on its category: a transfer has no
 * payee of its own and takes the merchant the app puts on its own transfers, while everything else
 * takes the one meaning the payee is not known.
 *
 * Mapping a column is offered only where none is mapped, since that is the better answer when the
 * file does hold the payee under a heading the guesser did not recognise. Where one is mapped there
 * is nothing to map, and the rows are the ones whose cell was left blank
 */
export function getRowsWithNoPayeeExplanation(rowCount: number, isMerchantColumnMapped: boolean) {
  const isOne = rowCount === 1
  const subject = isMerchantColumnMapped
    ? `${isOne ? '1 row leaves' : `${rowCount.toLocaleString()} rows leave`} the payee column blank`
    : `${isOne ? '1 row states' : `${rowCount.toLocaleString()} rows state`} no payee`
  const filed = `every transaction carries a merchant, so ${isOne ? 'it will be' : 'they will be'} filed under a merchant that ships with the app`

  return isMerchantColumnMapped
    ? `${subject}, and ${filed}.`
    : `${subject}, and ${filed}. Map the column holding the payee above if the file has one.`
}

// Shown over the upload control while the currency list is not in hand. Reading a file uses it to
// tell a cell holding a currency from a header word shaped like one, and that decision is kept on
// the staged file, so a file read without the list stays wrongly read once it arrives
export const CURRENCIES_LOADING_UPLOAD_BLOCK = 'Loading currencies...'
export const CURRENCIES_FAILED_UPLOAD_BLOCK = 'Currencies could not be loaded, and a file cannot be read without them. Reload the page to try again.'

// How many entries the skipped table lists before summarizing the remainder, shared by every table
// built on it: refused rows in both import flows, and the Firefly budgets it cannot bring in
export const SKIPPED_TABLE_VISIBLE_LIMIT = 20

// How many compiled transactions the preview shows. Read by the builder that stops at it and by the
// step description that states it, so the two cannot disagree about what is on screen
export const IMPORT_SAMPLE_PREVIEW_LIMIT = 5

// Why one row cannot be converted, listed against that row in the preview step. They read as one
// family: what is wrong with this row, then what to do about it where there is a choice about that.
// Each speaks of the row itself, since the entry carries the row number and the row's own cells, and
// each speaks of a cell rather than a source, which is the word the mapping step uses for the values
// a column holds. A blank cell is told apart from an unreadable one, because filling it in and
// correcting the whole column's format are different jobs
export const ROW_ACCOUNT_BLANK_REASON = 'The account cell is blank.'
export const ROW_CATEGORY_BLANK_REASON = 'The category cell is blank.'
export const ROW_DATE_BLANK_REASON = 'The date cell is blank.'
export const ROW_DATE_UNREADABLE_REASON = 'The date does not match the date format chosen above.'
export const ROW_AMOUNT_BLANK_REASON = 'The amount cell is blank.'
export const ROW_AMOUNT_UNREADABLE_REASON = 'The amount is not a number.'
export const ROW_AMOUNT_TOO_LARGE_REASON = 'The amount is larger than this app can store.'

// The five ways a row cannot be read from the columns holding money out and money in. The first
// needs both mapped to happen at all, since one side alone leaves the other empty. The next two each
// send the user to map the column holding the other direction, which is the fix whichever way the
// file leaves the unstated side
export const ROW_AMOUNT_BOTH_SIDES_REASON = 'This row states both a money out and a money in amount, so its direction is unclear.'
export const ROW_AMOUNT_NO_SIDE_REASON = 'This row leaves every amount column mapped for this file blank. If the file holds the other direction in a column of its own, map that column too.'
// Told apart from the reason above because the row is not empty and the table shows the user the
// zero it holds, so being told it states nothing would contradict what is in front of them
export const ROW_AMOUNT_SIDE_STATES_ZERO_REASON = 'The one amount column mapped states zero on this row, so this row is the direction that column does not hold. If the file states that direction in a separate column, map that column too.'

// The last two are a sign the column cannot mean. Both fixes are offered because either one can be
// what happened: the sign was written where the column already states the direction, or the value
// belongs in the column for the other direction and this row did not use it. They are separate
// constants rather than one, since the reason is looked up by problem alone and a single sentence
// could not say which of the two columns it meant
export const ROW_AMOUNT_OUT_SIDE_PLUS_REASON = 'The money out column carries a plus sign on this row. Write it unsigned or with a minus sign, or move it to the money in column where it is money arriving.'
export const ROW_AMOUNT_IN_SIDE_MINUS_REASON = 'The money in column carries a minus sign on this row. Write it unsigned or with a plus sign, or move it to the money out column where it is money leaving.'

// The two ways a row cannot be read from a file carrying its direction in a column of words. Neither
// can be answered in the app, since one is a cell nobody filled in and the other is two cells of the
// same row contradicting each other, so both send the user to the file
export const ROW_DIRECTION_BLANK_REASON = 'The direction cell is blank, so this row does not specify whether it is money in or money out.'
export const ROW_DIRECTION_SIGN_DISAGREES_REASON = 'The sign on this row\'s amount contradicts its direction column. Write the amount unsigned, or give it the sign matching its direction.'

/**
 * Says an amount carries decimal places its currency does not have
 *
 * How many are allowed is the currency's answer rather than the importer's, so the message states
 * it. It also says how a period is read, because an amount like 1.234 written with a period
 * grouping the thousands fails here, and without that sentence the reason reads as a complaint
 * about a number the user considers whole
 */
export function getRowAmountTooPreciseReason(currency: string) {
  return `The amount has more decimal places than ${currency} has. A period is read as a decimal point, never as a separator between thousands.`
}
// The two ways the counterparty column contradicts the rest of the row. Both open with what this row
// states rather than with the rule it breaks, since a rule leaves the user working out which of
// their cells it was about
export const ROW_COUNTERPARTY_NOT_A_TRANSFER_REASON = 'This row states a counterparty account but is not filed under a transfer category. Only a transfer records where the money went, so clear that cell or change the category.'
export const ROW_COUNTERPARTY_IS_OWN_ACCOUNT_REASON = 'This row states its own account as the counterparty, so the transfer would go nowhere. That cell holds the account on the other side of the transfer.'

/**
 * Says a row states a currency its account is not kept in
 *
 * Both codes are given because the fix is a choice between them: either the row belongs in a
 * different account, or the column mapped as the currency is not what it looked like
 */
export function getRowCurrencyMismatchReason(rowCurrency: string, accountCurrency: string) {
  return `This row is in ${rowCurrency} but the account it would be written to is kept in ${accountCurrency}. Amounts are stored in the account's currency and are not converted, so write these rows to a ${rowCurrency} account, or set the Currency column to Do not import to bring them in as ${accountCurrency}.`
}
/**
 * Says a row is money going the way its category does not usually record
 *
 * Written per kind rather than as one sentence, so it can state what the row is and what it is filed
 * under. One sentence covering both had to describe the relation between them instead, and a
 * category kind is a classification rather than a direction, so an amount cannot move against it
 *
 * It states what the row is, then the ordinary thing that looks like this, then that it is taken, in
 * that order, because a refund inside an expense category is exactly what this fires on and reading
 * it as a fault the user introduced would be wrong. That the row is taken is stated here rather than
 * in the heading above the table, which offers a look and cannot also carry it
 *
 * Worth saying at all because the app then counts the row two ways: cash flow reads the sign while
 * the category total reads the kind
 *
 * This is the one place the direction rule between an amount and a category kind is stated, since it
 * sits with the rows it is about. The note above the column mapping table covers the arrangements
 * and the sign rule and leaves this to it
 */
export function getRowSignDisagreesWithCategoryReason(kind: 'expense' | 'income') {
  return kind === 'expense'
    ? 'Money coming in, filed under an expense category. That is what a refund looks like, so the row imports as it stands.'
    : 'Money going out, filed under an income category. That is what returning money you were paid looks like, so the row imports as it stands.'
}

// Shown once for the whole file where every amount reads as money coming in, which is either a file
// of nothing but income or one being read backwards. It cannot tell those apart, so it says what the
// rows come to and lists what to check, rather than asserting which of the two this is
export const NO_OUTFLOWS_WARNING = 'Every row in this file reads as money coming in. If that is right, there is nothing to do. If it is not, check three things: that the money going out is mapped to the column actually holding it, that a file using one Amount column writes its money out with a minus sign, and that a file using a Direction column has its words set the way round the file means them.'

// Shown where a source rows are written to matches an account the user has archived, which is the
// one account that source is not offered. The matched account names follow it
export const ARCHIVED_ACCOUNT_MATCH_EXPLANATION = 'An archived account takes no new transactions, so it is not offered as a choice here. Unarchive one of these to import rows into it, which means leaving this import and uploading your file again:'

// Shown once any source on either table is answered create, since nothing else in the flow says
// what an account made this way is and is not given
export const CREATED_ACCOUNT_TITLE = 'New accounts'
export const CREATED_ACCOUNT_EXPLANATION = 'These will be created as new accounts, each starting with no opening balance and no credit limit:'
// A balance adjustment rather than a field, because an account that already exists has no starting
// balance to set. Left to the user to want one rather than told to enter one, since a Firefly
// export carries its own opening balances and the import writes those as balance adjustments
// already
export const CREATED_ACCOUNT_BALANCE_NOTE = 'To give one an opening balance, add a balance adjustment transaction in that account'
// The edit button this describes is the pencil on the account's own card, which is the only place a
// credit limit can be set once the account exists
export const CREATED_ACCOUNT_CREDIT_LIMIT_NOTE = 'To set a credit limit, open the account from Accounts and use the edit button on its card'

// Shown in place of a mapping step whose list could not be fetched at all, since answering one
// against nothing maps every value to a new record and duplicates what the user already has
export const ACCOUNTS_LOAD_FAILURE_TITLE = 'Your accounts could not be loaded'
export const ACCOUNTS_LOAD_FAILURE_EXPLANATION = 'Without them every source here would have to become a new account, which would duplicate accounts you already have.'
export const CATEGORIES_LOAD_FAILURE_TITLE = 'Your categories could not be loaded'
export const CATEGORIES_LOAD_FAILURE_EXPLANATION = 'Without them every category in this file would have to become a new one, which would duplicate categories you already have.'

// Shown when the page could not ask which of the file's payee values already have a merchant.
// Every value would then read as one about to be created, which is what the step exists to stop
export const MERCHANT_MATCHES_LOAD_FAILURE_TITLE = 'Your merchants could not be checked'
export const MERCHANT_MATCHES_LOAD_FAILURE_EXPLANATION = 'Without that check every payee in this file reads as a new merchant, and importing would create merchants you already have.'

// Shown when a mapping was answered with an account that has since been deleted. The answer is
// dropped rather than sent, and nothing fills the row back in, so the user is told why a source
// they already dealt with is asking again
export const CLEARED_ACCOUNT_SOURCES_TITLE = 'Answers cleared'
// The answers a row can be given differ between the two tables, and one notice covers both, so it
// asks for an answer rather than listing which ones are on offer
export const CLEARED_ACCOUNT_SOURCES_EXPLANATION = 'An account these sources were matched to no longer exists, so their answers were cleared. Answer each one again:'
export const CLEARED_CATEGORY_SOURCES_TITLE = 'Answers cleared'
export const CLEARED_CATEGORY_SOURCES_EXPLANATION = 'A category these values were matched to no longer exists, so their answers were cleared. Choose a category for each one, or queue a new one for it:'

// Carries the account an import was started from, as a query parameter rather than router state so
// the scope survives a reload and a shared address
export const IMPORT_ACCOUNT_PARAM = 'account'

// Shown in place of the whole import page when the address points at an account no import can be
// written to. The button offering the import is disabled in those states, so this is reached by a
// typed or shared address, or by an account whose state changed after the address was made
// The account is only ever missing from the list, archived or closed, and the list leaves out both
// an account that has gone and one belonging to someone else, so the wording covers being unable to
// import into it rather than claiming to know which of those it is
export const IMPORT_NOT_PERMITTED_TITLE = 'This action is not permitted'
export const IMPORT_NOT_PERMITTED_EXPLANATION = 'Transactions can only be imported into an account that is open and not archived. This one is archived, closed, or not an account you can import into.'

// Shown in place of the whole page where the accounts list cannot say whether this account takes an
// import. The mapping step's own failure text is about mapping sources onto a list, which is a
// question this page never reaches
export const IMPORT_SCOPE_FAILURE_TITLE = 'Your accounts could not be loaded'
export const IMPORT_SCOPE_FAILURE_EXPLANATION = 'Without them this import cannot tell whether it may write to the account it was started from.'

// Shown above the column mapping table, under the note about amounts, because what currency an
// amount lands in is the other half of how a number is read and the Currency column is mapped here.
// It speaks of the account each source is mapped to, which is the step after this one, since that is
// where the answer comes from even though the question arises while the columns are being chosen
export const CURRENCY_HANDLING_TITLE = 'How currencies are read'
export const CURRENCY_HANDLING_NOTE = 'Imported amounts are treated as raw values. Each one is assigned the currency of the account its row is mapped to, or the currency shown against a new account, which is taken from the file where it states one and can be changed on any row.'

/**
 * Says what a scoped import does with the currency of the account it writes to
 *
 * Replaces the ordinary currency note, which speaks of the account each source is mapped to and of
 * changing a currency on a row, neither of which a scoped import has. A row stating another currency
 * stops the whole import rather than being dropped from it, since one unimportable row leaves the
 * commit with no payload at all
 */
export function getFixedAccountCurrencyNote(accountName: string, currency: string) {
  return `Imported amounts are treated as raw values. Every row will be assigned ${currency}, the currency ${accountName} is kept in, and a row stating a different currency stops the import until the file is corrected or its currency column is set to Do not import.`
}

// The file cannot be checked for covering more than one account, since the column that would say so
// is not offered here, so the notice says what the import will do and offers the way out. The
// currency is named alongside it because a file the account's currency refuses is the other reason
// to leave, and both are answered by the same page
export const FIXED_ACCOUNT_WARNING_TITLE = 'One account only'
export const FIXED_ACCOUNT_WARNING_LINK_LABEL = 'Open the full import page'

/**
 * Says what a scoped import will do with a file it is the wrong page for
 *
 * Shown before a file is staged as well as after, so it speaks of the import rather than of a file
 * on screen, and it is the one place the step says which account the rows are going to
 */
export function getFixedAccountWarning(accountName: string) {
  return `Every transaction imported here will be written to ${accountName}. A file covering more than one account, or holding amounts in a currency this account is not kept in, has to go through the full import page.`
}

// Shown over the accounts that appear only as a counterparty, which the import writes nothing to
export const COUNTERPARTY_ONLY_TABLE_TITLE = 'Counterparty accounts'
export const COUNTERPARTY_ONLY_EXPLANATION = 'These only ever appeared as the other side of a transfer. Matching one records where the money came from or went to without writing a transaction into that account, which is why an archived account can be chosen here and stays archived. Leave one unmatched and the transfer is recorded as going outside this app. To bring a name in as an account of your own, choose Create New Account in its Existing Account column.'

// Each format is named by an example of its shape rather than by a standard, because the year-first
// option deliberately takes a slash and an unpadded part, which ISO 8601 does not. Keyed by format
// rather than listed, so every format is guaranteed a label and the picker takes its order from
// IMPORT_DATE_FORMATS instead of repeating it here
export const IMPORT_DATE_FORMAT_LABELS: Record<ImportDateFormat, { label: string; example: string }> = {
  yearFirst: { label: 'Year first', example: '2026-04-30' },
  dayFirst: { label: 'Day first', example: '30/04/2026' },
  monthFirst: { label: 'Month first', example: '04/30/2026' },
  written: { label: 'Written', example: 'April 30, 2026' },
}

export const KIND_LABELS: Record<Category['kind'], string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
}

// Kind decides which group a category falls under in the import dropdowns, and an explicit rank
// fixes that group order rather than leaving it to the browser's language rules, which can differ
// between a user's devices. The ranks run alphabetically, matching what the dropdown showed before,
// so a kind added later has to be placed here for the order to stay alphabetical
export const KIND_RANKS: Record<Category['kind'], number> = {
  expense: 0,
  income: 1,
  transfer: 2,
}

export const DEFAULT_CATEGORY_ICON = '🏷️'
export const CREATE_ACCOUNT_VALUE = '__create_account__'
export const CREATE_CATEGORY_VALUE = '__create_category__'

// What the batch bar's institution control holds before anything is chosen. The institution list
// already spends the empty string on "None", which is a real answer meaning the account belongs to
// no institution, so nothing chosen needs a value of its own. Absent from the options list, which
// is what leaves the control showing its placeholder rather than the first option's label
export const UNSET_BATCH_INSTITUTION = '__unset_institution__'
// The two answers a word in a Direction column can be given, worded from the account's point of view
// rather than as debit and credit, which are the bookkeeping terms the file itself may or may not use
export const IMPORT_DIRECTION_OPTIONS: Array<{ value: ImportAmountDirection; label: string }> = [
  { value: 'out', label: 'Money out' },
  { value: 'in', label: 'Money in' },
]

export const IMPORT_CATEGORY_KIND_OPTIONS: Array<{ value: ImportCategoryKind; label: string }> = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
]

export const ACCOUNT_KIND_LABELS: Record<AccountsOverview['account_kind'], string> = {
  asset: 'Assets',
  revolving: 'Revolving Credit',
  amortizing: 'Amortizing Debt',
}

// Kind decides which group an account falls under, and the dropdown heads a group every time the
// group changes going down the list, so accounts have to arrive gathered by kind or a kind reached
// twice is headed twice. The order is the one the account type list already uses
export const ACCOUNT_KIND_RANKS: Record<AccountsOverview['account_kind'], number> = {
  asset: 0,
  revolving: 1,
  amortizing: 2,
}

export const ACCOUNT_TYPE_OPTIONS: DropdownOption[] = [
  { value: 'checking', label: 'Checking', group: 'Assets' },
  { value: 'savings', label: 'Savings', group: 'Assets' },
  { value: 'term_deposit', label: 'Term Deposit', group: 'Assets' },
  { value: 'cash', label: 'Cash', group: 'Assets' },
  { value: 'investment', label: 'Investment', group: 'Assets' },
  { value: 'credit_card', label: 'Credit Card', group: 'Revolving Credit' },
  { value: 'line_of_credit', label: 'Line of Credit', group: 'Revolving Credit' },
  { value: 'heloc', label: 'HELOC', group: 'Revolving Credit' },
  { value: 'loan', label: 'Loan', group: 'Amortizing Debt' },
  { value: 'mortgage', label: 'Mortgage', group: 'Amortizing Debt' },
]

export const IMPORT_INSET_STYLE: CSSProperties = {
  background: 'color-mix(in srgb, var(--app-input-bg) 58%, var(--app-bg))',
}
