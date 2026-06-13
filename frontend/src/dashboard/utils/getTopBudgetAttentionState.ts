export type TopBudgetAttentionState = {
  label: string
  textColor: string
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
      indicatorColor: 'var(--app-negative)',
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
    indicatorColor: 'var(--app-positive)',
  }
}
