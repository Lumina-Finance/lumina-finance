/**
 * Tests which card says what an import does with its data, so the CSV import has one like the
 * provider imports and each provider keeps its own
 */
import { describe, expect, it } from 'vitest'
import { ACTUAL_EXPECTATIONS } from '@/pages/imports/actual/expectations'
import { FIREFLY_EXPECTATIONS } from '@/pages/imports/firefly/expectations'
import { getImportExpectations } from '@/pages/imports/expectations'

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
      'Lumina Finance records each row of your file as one transaction in Everyday chequing, and reads only the columns you map.',
    )
  })

  it('keeps the Firefly III and Actual Budget cards as they are', () => {
    expect(getImportExpectations('firefly', null)).toBe(FIREFLY_EXPECTATIONS)
    expect(getImportExpectations('actual', null)).toBe(ACTUAL_EXPECTATIONS)
  })
})
