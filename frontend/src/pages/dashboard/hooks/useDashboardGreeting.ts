/**
 * Returns the dashboard greeting copy for the current local hour
 */
export function useDashboardGreeting() {
  const hour = new Date().getHours()
  const greeting =
    hour >= 1 && hour < 4 ? 'Still Up?' :
    hour < 12 ? 'Good Morning' :
    hour < 17 ? 'Good Afternoon' :
    'Good Evening'

  const subtitle =
    hour >= 1 && hour < 4
      ? 'Your finances can wait, your sleep can\u2019t.'
      : 'Here is your financial overview.'

  return { greeting, subtitle }
}
