import { getValueMarkColor } from '@/utils/valueMarkColor'

export type TopBudgetAttentionState = {
  label: string

  /** Colour of the written status, which needs contrast against the widget behind it */
  textColor: string

  /** The same text while its row is tinted under the pointer, where the plain green falls under 4.5:1 in the light theme */
  tintedTextColor: string

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
      tintedTextColor: 'var(--app-negative)',
      indicatorColor: getValueMarkColor('negative'),
    }
  }

  if (usagePct >= 80) {
    return {
      label: 'Watch',
      textColor: 'var(--app-warning-text)',
      tintedTextColor: 'var(--app-warning-text)',
      indicatorColor: 'var(--app-warning)',
    }
  }

  return {
    label: 'On track',
    textColor: 'var(--app-positive)',
    tintedTextColor: 'var(--app-positive-on-accent-tint)',
    indicatorColor: getValueMarkColor('positive'),
  }
}
