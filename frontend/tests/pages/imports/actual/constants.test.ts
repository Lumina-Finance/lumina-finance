/**
 * Tests the Actual Budget import's help for a category's payments to off-budget accounts, which
 * once described an income category's payments as spending its budget counts
 */
import { describe, expect, it } from 'vitest'
import { getActualPaymentsHelp } from '@/pages/imports/actual/constants'

describe('Actual Budget payments help', () => {
  it('describes an expense category\'s payments as spending its budget counts', () => {
    const help = getActualPaymentsHelp('Car', false)

    expect(help).toContain('As Expense, they count as spending in Car, so its budget counts them')
    expect(help).not.toContain('As Income')
  })

  it('describes an income category\'s payments as income, with no budget counting them', () => {
    const help = getActualPaymentsHelp('Bonus', true)

    expect(help).toContain('As Income, they count as income in Bonus')
    expect(help).not.toMatch(/spending in Bonus|budget counts/)
  })
})
