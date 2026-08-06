/**
 * Tests the dashboard greeting, so which greeting a user sees cannot drift from the local hour it is
 * chosen by
 */
import { describe, expect, it } from 'vitest'
import { getDashboardGreetingForHour } from '@/pages/dashboard/hooks/useDashboardGreeting'

describe('dashboard greeting', () => {
  it('chooses the dashboard greeting from local hour boundaries', () => {
    expect(getDashboardGreetingForHour(0)).toEqual({
      greeting: 'Still up?',
      subtitle: 'Your finances can wait, your sleep can’t.',
    })
    expect(getDashboardGreetingForHour(3)).toMatchObject({ greeting: 'Still up?' })
    expect(getDashboardGreetingForHour(4)).toMatchObject({ greeting: 'Good morning' })
    expect(getDashboardGreetingForHour(11)).toMatchObject({ greeting: 'Good morning' })
    expect(getDashboardGreetingForHour(12)).toMatchObject({ greeting: 'Good afternoon' })
    expect(getDashboardGreetingForHour(15)).toMatchObject({ greeting: 'Good afternoon' })
    expect(getDashboardGreetingForHour(16)).toMatchObject({ greeting: 'Good evening' })
    expect(getDashboardGreetingForHour(20)).toMatchObject({ greeting: 'Good evening' })
    expect(getDashboardGreetingForHour(21)).toEqual({
      greeting: 'It’s getting late...',
      subtitle: 'Your finances can wait, your sleep can’t.',
    })
    expect(getDashboardGreetingForHour(23)).toEqual({
      greeting: 'It’s getting late...',
      subtitle: 'Your finances can wait, your sleep can’t.',
    })
  })
})
