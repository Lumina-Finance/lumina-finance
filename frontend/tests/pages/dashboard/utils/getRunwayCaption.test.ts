/**
 * Tests the runway caption, so what a user reads under the runway figure cannot drift from the reason
 * the backend gave for it
 */
import { describe, expect, it } from 'vitest'
import { getRunwayCaption } from '@/pages/dashboard/utils/getRunwayCaption'
import { currencies, runway } from './fixtures'

describe('runway caption', () => {
  it('builds runway captions', () => {
    expect(getRunwayCaption({ ...runway, reason: 'no_accounts' }, 'USD', currencies)).toBe('Choose accounts in Settings')
    expect(getRunwayCaption(runway, 'USD', currencies)).toContain('/mth · 3 mths basis')
  })
})
