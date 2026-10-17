/**
 * Tests which card says what an import does with its data, so the CSV import has one like the
 * provider imports and each provider keeps its own
 */
import { describe, expect, it } from 'vitest'
import { ACTUAL_EXPECTATIONS } from '@/pages/imports/actual/expectations'
import { FIREFLY_EXPECTATIONS } from '@/pages/imports/firefly/expectations'
import { getImportExpectations } from '@/pages/imports/expectations'
import { OFX_EXPECTATIONS } from '@/pages/imports/ofx/expectations'

describe('the card saying what an import does with its data', () => {
  // The card's wording is checked by reading it against the code, so this pins only that every part
  // of it is filled
  it('shows a CSV card of its own, with every part filled, when CSV is the source', () => {
    const expectations = getImportExpectations('generic', null)

    expect(expectations).not.toBe(FIREFLY_EXPECTATIONS)
    expect(expectations).not.toBe(ACTUAL_EXPECTATIONS)
    expect(expectations.intro).not.toBe('')
    expect(expectations.deviation).not.toBe('')
    expect(expectations.changes.length).toBeGreaterThan(0)
    expect(expectations.leftBehind.flatMap((group) => group.items).length).toBeGreaterThan(0)
  })

  // Started from an account's page, every row goes to that account and nothing asks where
  it('names the account an import started from an account writes every row to', () => {
    expect(getImportExpectations('generic', 'Everyday chequing').intro).toBe(
      'Each row of your import becomes one transaction in Everyday chequing.',
    )
  })

  // Started from an account's page, the statement goes to that account, nothing is created, and a
  // file of several statements is refused, so the card must not promise the general import's matching
  it('names the account an OFX import started from an account writes to, and says several statements are refused', () => {
    const expectations = getImportExpectations('ofx', 'Everyday chequing')

    expect(expectations.intro).toBe('Each transaction in your statement becomes one transaction in Everyday chequing.')
    expect(expectations.changes.map((change) => change.source)).toContain('A file with several statements')
    expect(expectations.changes.map((change) => change.source)).not.toContain('A new account')

    // The skip of an earlier import's transactions names the account rather than "the account"
    const sources = expectations.changes.map((change) => change.source)
    expect(sources).toContain('A transaction an earlier OFX import brought into Everyday chequing')
    expect(sources).not.toContain('A transaction an earlier OFX import brought into the account')
  })

  // The card promises only what the import enforces, so each promise is pinned to the rule it states
  it('shows an OFX card that says where a statement goes, what is refused, and what is left behind', () => {
    const expectations = getImportExpectations('ofx', null)

    expect(expectations).toBe(OFX_EXPECTATIONS)
    expect(expectations.intro).toBe('Each transaction in your statements becomes one transaction in the account you match them to, so one file can fill several accounts and several files can fill one.')
    expect(expectations.deviation).toBe("The balance your bank states isn't imported. A new account starts at zero, so it only counts the transactions you import.")
    expect(expectations.changes.map((change) => change.source)).toEqual([
      'A payee',
      'A memo',
      'A transaction',
      'A transaction an earlier OFX import brought into the account',
      'A statement in another currency than its account',
      'A new account',
    ])
    expect(expectations.changes.find((change) => change.source.startsWith('A transaction an earlier'))?.lumina).toMatch(/^Skipped/)
    expect(expectations.changes.find((change) => change.source === 'A transaction')?.lumina).toBe(
      'Filed under Miscellaneous when money goes out and Other Income when it comes in, since statements carry no categories',
    )
    expect(expectations.changes.find((change) => change.source.startsWith('A statement in another'))?.lumina).toMatch(/^Refused/)
    expect(expectations.leftBehind).toEqual([
      { group: 'Statements', items: ['Investment', 'Loan'] },
      {
        group: 'Transactions',
        items: [
          'With no readable date or amount',
          'With an amount in another currency than their statement',
          'With more decimal places than their currency allows',
          'With a payee name or memo over the limits this app takes',
          'Already in an earlier file of the same import, by the bank\'s transaction ID',
          'Listed twice in the same file',
          'With a bank ID over the length this app takes',
        ],
      },
      { group: 'Not imported', items: ['Check numbers and transaction types'] },
    ])
  })

  it('keeps the Firefly III and Actual Budget cards as they are', () => {
    expect(getImportExpectations('firefly', null)).toBe(FIREFLY_EXPECTATIONS)
    expect(getImportExpectations('actual', null)).toBe(ACTUAL_EXPECTATIONS)
  })
})
