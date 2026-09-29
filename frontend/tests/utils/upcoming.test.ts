/**
 * Tests the split behind the Upcoming section, so a transaction dated today never hides as upcoming and a
 * date the calendar doesn't have stays in view with the rest
 */
import { describe, expect, it } from 'vitest'
import { splitUpcoming } from '@/utils/upcoming'

type Dated = { id: string; dt: string }

const split = (items: Dated[], today: string) => splitUpcoming(items, (item) => item.dt, today)

describe('splitUpcoming', () => {
  it('puts only dates after today in upcoming, keeping today with the rest', () => {
    const items = [
      { id: 'rent', dt: '2026-10-03' },
      { id: 'salary', dt: '2026-10-01' },
      { id: 'coffee', dt: '2026-09-28' },
      { id: 'groceries', dt: '2026-09-27' },
    ]

    const { upcoming, rest } = split(items, '2026-09-28')

    expect(upcoming.map((item) => item.id)).toEqual(['rent', 'salary'])
    expect(rest.map((item) => item.id)).toEqual(['coffee', 'groceries'])
  })

  it('leaves a date the calendar does not have with the rest rather than guessing its side', () => {
    const { upcoming, rest } = split([{ id: 'broken', dt: '2026-02-31' }], '2026-01-01')

    expect(upcoming).toEqual([])
    expect(rest.map((item) => item.id)).toEqual(['broken'])
  })
})
