import { describe, expect, it } from 'vitest'
import { buildTimezoneOptions } from '@/utils/timezoneOptions'

describe('buildTimezoneOptions', () => {
  it('includes UTC when the browser inventory omits the current timezone', () => {
    expect(buildTimezoneOptions(['America/Toronto'], 'UTC')).toEqual([
      { value: 'America/Toronto', label: 'America/Toronto' },
      { value: 'UTC', label: 'UTC' },
    ])
  })

  it('preserves the exact value of a valid alias instead of canonicalizing it', () => {
    expect(buildTimezoneOptions(['America/New_York'], 'US/Eastern').map((option) => option.value))
      .toEqual(['America/New_York', 'US/Eastern'])
  })

  it('keeps a listed current timezone unchanged and removes exact duplicates', () => {
    expect(buildTimezoneOptions(['America/Toronto', 'America/Toronto'], 'America/Toronto'))
      .toEqual([{ value: 'America/Toronto', label: 'America/Toronto' }])
  })

  it('keeps existing label formatting for appended timezone names', () => {
    expect(buildTimezoneOptions([], 'America/Los_Angeles'))
      .toEqual([{ value: 'America/Los_Angeles', label: 'America/Los Angeles' }])
  })

  it.each(['', 'Invalid/Timezone'])('does not append invalid current value %j', (current) => {
    expect(buildTimezoneOptions(['America/Toronto'], current))
      .toEqual([{ value: 'America/Toronto', label: 'America/Toronto' }])
  })
})
