import type {
  MerchantMarketMerchant,
  MerchantMarketTile,
} from '@/insights/types/merchantDistribution'

/**
 * Splits merchant spending recursively into proportional treemap tiles
 */
export function splitMerchantTreemapItems(
  items: MerchantMarketMerchant[],
  x: number,
  y: number,
  width: number,
  height: number,
): MerchantMarketTile[] {
  if (items.length <= 1) {
    const item = items[0]
    return item ? [{ ...item, x, y, width, height }] : []
  }

  const total = items.reduce((sum, item) => sum + item.totalAmount, 0)
  let running = 0
  let splitIndex = 1
  for (let index = 0; index < items.length - 1; index += 1) {
    running += items[index].totalAmount
    if (running >= total / 2) {
      splitIndex = index + 1
      break
    }
  }

  const firstGroup = items.slice(0, splitIndex)
  const secondGroup = items.slice(splitIndex)
  const firstTotal = firstGroup.reduce((sum, item) => sum + item.totalAmount, 0)
  const firstShare = total > 0 ? firstTotal / total : 0.5

  if (width >= height) {
    const firstWidth = width * firstShare
    return [
      ...splitMerchantTreemapItems(firstGroup, x, y, firstWidth, height),
      ...splitMerchantTreemapItems(secondGroup, x + firstWidth, y, width - firstWidth, height),
    ]
  }

  const firstHeight = height * firstShare
  return [
    ...splitMerchantTreemapItems(firstGroup, x, y, width, firstHeight),
    ...splitMerchantTreemapItems(secondGroup, x, y + firstHeight, width, height - firstHeight),
  ]
}

/**
 * Colours merchant tiles by spend direction and strength
 */
function getMerchantMarketColor(changePct: number | null, changeAmount: number | null) {
  if (changePct === null && changeAmount === null) {
    return 'color-mix(in srgb, var(--app-text-muted) 24%, var(--app-input-bg))'
  }
  if (changePct === 0 || changeAmount === 0) {
    return 'color-mix(in srgb, var(--app-accent) 14%, var(--app-input-bg))'
  }
  const direction = changePct ?? changeAmount ?? 0
  const variable = direction < 0 ? 'var(--app-chart-positive)' : 'var(--app-chart-negative)'
  const mix = changePct === null ? 34 : Math.min(72, 24 + Math.abs(changePct) * 2.2)
  return `color-mix(in srgb, ${variable} ${mix}%, var(--app-input-bg))`
}

/**
 * Applies the neutral colour policy for rolled-up merchant tiles
 */
export function getMerchantTileColor(merchant: MerchantMarketTile) {
  if (merchant.id === 'other-merchants') {
    return 'color-mix(in srgb, var(--app-text-muted) 24%, var(--app-input-bg))'
  }
  return getMerchantMarketColor(merchant.changePct, merchant.changeAmount)
}
