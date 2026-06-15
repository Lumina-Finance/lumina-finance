import { useEffect, useState } from 'react'

/**
 * Returns the dashboard greeting copy for a local hour
 */
export function getDashboardGreetingForHour(hour: number) {
  const isSleepHours = hour < 4 || hour >= 21
  const greeting =
    hour < 4 ? 'Still up?' :
    hour < 12 ? 'Good morning' :
    hour < 16 ? 'Good afternoon' :
    hour < 21 ? 'Good evening' :
    'It\u2019s getting late...'

  const subtitle =
    isSleepHours
      ? 'Your finances can wait, your sleep can\u2019t.'
      : 'Here is your financial overview.'

  return { greeting, subtitle }
}

/**
 * Returns the dashboard greeting copy and refreshes it when the window regains focus
 */
export function useDashboardGreeting() {
  const [greeting, setGreeting] = useState(() => getDashboardGreetingForHour(new Date().getHours()))

  useEffect(() => {
    const handleWindowFocus = () => {
      setGreeting(getDashboardGreetingForHour(new Date().getHours()))
    }

    window.addEventListener('focus', handleWindowFocus)
    return () => window.removeEventListener('focus', handleWindowFocus)
  }, [])

  return greeting
}
