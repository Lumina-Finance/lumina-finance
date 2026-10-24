/** The id of one tick box in an acknowledgement group, so the group's owner can focus it */
export function getAcknowledgementItemId(groupId: string, itemKey: string): string {
  return `${groupId}-${itemKey}`
}

/** The tick box a refused press should focus: the first one still unticked */
export function getFirstUntickedKey(keys: readonly string[], ticks: readonly boolean[]): string {
  const index = ticks.findIndex((ticked) => !ticked)
  return keys[index === -1 ? 0 : index]
}

/** What is missing from a group of tick boxes, or nothing once every one is ticked */
export function getAcknowledgementProblem(ticks: readonly boolean[]): string | undefined {
  if (ticks.every(Boolean)) return undefined
  return ticks.length === 1 ? 'Tick the box' : 'Tick both boxes'
}
