const MIB = 1024 * 1024

/** Largest export zip the import opens, checked before anything is unpacked */
export const MAX_ACTUAL_ZIP_BYTES = 100 * MIB

/**
 * Largest database the import opens, whether it arrives bare or unpacked from a zip. Actual keeps
 * its sync history in the same file, so a long-used budget is several times its data
 */
export const MAX_ACTUAL_DATABASE_BYTES = 250 * MIB

/** Most the import unpacks from one zip, whatever it declares, so a zip bomb stops at the listing */
export const MAX_ACTUAL_UNPACKED_BYTES = 250 * MIB

/** The file Actual keeps a budget in, at the top of its export zip or inside one folder */
export const ACTUAL_DATABASE_FILE_NAME = 'db.sqlite'
export const ACTUAL_METADATA_FILE_NAME = 'metadata.json'

/**
 * Actual 26.9 keeps every transaction in hundredths whatever the budget's currency, even though
 * its currency feature treats some currencies as having no decimal places
 */
export const ACTUAL_TRANSACTION_DECIMALS = 2

/**
 * Currencies Actual 26.9's own currency table gives no decimal places. Once its currency feature
 * is on, its budget screen stores figures in these currencies as whole units, not hundredths
 */
export const ACTUAL_ZERO_DECIMAL_CURRENCIES = new Set(['IRR', 'JPY', 'KRW'])

/**
 * Newest database migration in the Actual release the import was checked against. A file in a
 * zero-decimal currency from a later release is refused, since a release that starts storing
 * those transactions in whole units would otherwise import every amount 100 times too large, and
 * nothing in the file says which way a row was written
 */
export const ACTUAL_NEWEST_CHECKED_MIGRATION = 1787013118115

/**
 * Tables, views and columns the reader queries, checked before any are read. Transactions,
 * payees and categories are read through Actual's own views, so merges and deletions resolve the
 * way Actual's screens show them
 */
export const ACTUAL_REQUIRED_COLUMNS: Record<string, string[]> = {
  accounts: ['id', 'name', 'offbudget', 'closed', 'tombstone', 'type', 'sort_order'],
  category_groups: ['id', 'name', 'hidden'],
  category_mapping: ['id', 'transferId'],
  v_payees: ['id', 'name', 'transfer_acct', 'tombstone'],
  v_categories: ['id', 'name', 'is_income', 'hidden', 'group', 'tombstone'],
  v_transactions: [
    'id',
    'is_parent',
    'parent_id',
    'account',
    'category',
    'amount',
    'payee',
    'notes',
    'date',
    'starting_balance_flag',
    'transfer_id',
    'sort_order',
  ],
  zero_budgets: ['month', 'category', 'amount', 'carryover'],
  reflect_budgets: ['month', 'category', 'amount', 'carryover'],
  preferences: ['id', 'value'],
}

/** Where to get a file the import reads, repeated in each refusal that means the wrong file came */
export const ACTUAL_FILE_GUIDANCE = "Choose the .zip from Actual's Settings under Export data, or the db.sqlite in Actual's data folder."
