import { AT_EVERY_SIZE } from './sizes'

/**
 * Runs a test against a server offering bank sync, with SimpleFIN enabled and the fake SimpleFIN
 * Bridge beside it
 *
 * Taken by a test that connects, links or syncs a bank account, or reads what only a server
 * offering bank sync shows. CI runs every other test against a server with no bank provider
 * enabled, so each checks the app as the users of such a server see it
 */
export const NEEDS_BANK_SYNC = { tag: '@bank-sync' }

/** `NEEDS_BANK_SYNC` for a test that also runs at every size */
export const AT_EVERY_SIZE_NEEDS_BANK_SYNC = { tag: [AT_EVERY_SIZE.tag, NEEDS_BANK_SYNC.tag] }

/** Selects the tests tagged with `NEEDS_BANK_SYNC` */
export const BANK_SYNC_TESTS = new RegExp(NEEDS_BANK_SYNC.tag)

/** Selects every test not tagged with `NEEDS_BANK_SYNC` */
export const NO_BANK_SYNC_TESTS = new RegExp(`^(?!.*${NEEDS_BANK_SYNC.tag})`)
