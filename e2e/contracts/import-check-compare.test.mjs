import assert from 'node:assert/strict'
import { test } from 'node:test'

import { checkExpected, createMinorUnitsFormatter, DifferenceList } from '../support/import-check/compare.ts'

test('an expected difference matches only while its kind, subject and Lumina value all match', () => {
  const differences = [
    { kind: 'account-type', subject: 'Savings', firefly: 'savings', lumina: 'checking' },
    { kind: 'account-type', subject: 'Boat', firefly: 'loan', lumina: 'cash' },
  ]
  const exact = { kind: 'account-type', subject: 'Savings', lumina: 'checking', reason: 'known' }
  const expected = [
    exact,
    { kind: 'account-type', subject: 'Savings', lumina: 'cash', reason: 'another Lumina value' },
    { kind: 'balance', subject: 'Boat', lumina: 'cash', reason: 'another kind' },
    { kind: 'account-type', subject: 'Car', lumina: 'cash', reason: 'another subject' },
  ]
  assert.deepEqual(checkExpected(differences, expected), {
    unexpected: [differences[1]],
    stale: expected.filter((entry) => entry !== exact),
  })
})

// The workflow summaries read the other app's value by that app's name
for (const source of ['firefly', 'actual']) {
  test(`a repeated difference is listed once, counted under ${source}`, () => {
    const differences = new DifferenceList(source)
    differences.add('later-row', '2026-10-01 Checking -5.00', 'Food', 'absent')
    differences.add('later-row', '2026-10-01 Checking -5.00', 'Food', 'absent')
    differences.add('later-row', '2026-10-01 Checking -5.00', 'Food', 'another category')

    assert.deepEqual(differences.list(), [
      { kind: 'later-row', subject: '2026-10-01 Checking -5.00', [source]: 'Food (2 times)', lumina: 'absent' },
      { kind: 'later-row', subject: '2026-10-01 Checking -5.00', [source]: 'Food', lumina: 'another category' },
    ])
  })
}

test('Lumina\'s minor units are written in each currency\'s decimal places', () => {
  const format = createMinorUnitsFormatter({ CAD: 2, JPY: 0 })
  assert.equal(format(123456, 'CAD'), '1234.56')
  assert.equal(format(-5, 'CAD'), '-0.05')
  assert.equal(format(-1500, 'JPY'), '-1500')
  assert.equal(format(150, 'ZAR'), '150 minor units of ZAR')
})
