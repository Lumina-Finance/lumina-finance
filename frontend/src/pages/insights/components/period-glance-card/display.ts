import type { PeriodGlanceTone } from '@/pages/insights/types/periodGlance'

export const PERIOD_GLANCE_TITLE_CONTROL_SLOT_CLASS = 'inline-flex w-[1.375rem] shrink-0 items-center'

/**
 * Maps period-glance semantic tones to the app text colour classes
 */
export function getPeriodGlanceToneClass(tone: PeriodGlanceTone) {
  if (tone === 'positive') return 'text-[var(--app-positive)]'
  if (tone === 'negative') return 'text-[var(--app-negative)]'
  return ''
}
