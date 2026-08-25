import { getValueMarkColor } from '@/utils/valueMarkColor'

export type TopBudgetAttentionState = {
  label: string

  /** Colour of the written status, which needs contrast against the widget behind it */
  textColor: string

  /** Colour of the dot beside it, which is a shape and matches every other shape reading a value */
  indicatorColor: string
}

/**
 * Converts budget utilization into the dashboard attention label and colours
 */
export function getTopBudgetAttentionState(usagePct: number): TopBudgetAttentionState {
  if (usagePct >= 100) {
    return {
      label: 'Needs attention',
      textColor: 'var(--app-negative)',
      indicatorColor: getValueMarkColor('negative'),
    }
  }

  if (usagePct >= 80) {
    return {
      label: 'Watch',
      textColor: 'var(--app-warning-text)',
      indicatorColor: 'var(--app-warning)',
    }
  }

  return {
    label: 'On track',
    textColor: 'var(--app-positive)',
    indicatorColor: getValueMarkColor('positive'),
  }
}
