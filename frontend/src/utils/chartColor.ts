export type CategoryColorKind = 'expense' | 'income' | 'transfer'

type ChartColorMapInput = {
  key: string
  seed: string
  fixedColor?: string
}

type CategoryColorInput = {
  id: string
  name: string
  kind: CategoryColorKind
}

const OTHER_CATEGORY_COLOR = '#8C8074'
const PALETTE_PROBE_STEP = 17
const MIN_VISIBLE_COLOR_DISTANCE = 52

const CURATED_CHART_COLORS = [
  '#C9A96A',
  '#5D8F6D',
  '#AB5E56',
  '#7AAEC8',
  '#9B8FC8',
  '#D4906A',
  '#5E7FA3',
  '#A77B5A',
  '#6F9F95',
  '#C47D8A',
  '#8F9D5A',
  '#B77BA8',
  '#C08C42',
  '#6C8C5E',
  '#C26F5A',
  '#5F9AB7',
  '#8C8074',
  '#8775B5',
  '#B08A52',
  '#6B9A78',
  '#B96773',
  '#70916F',
  '#A66D96',
  '#7C8DB0',
  '#C77F4F',
  '#648C89',
  '#B65F63',
  '#9C8A4F',
  '#7C769E',
  '#B58A78',
  '#4F879B',
  '#A06F54',
  '#76915A',
  '#B07C8F',
  '#8D7B5E',
  '#6F94B0',
  '#9A7468',
  '#A39363',
  '#6E8F80',
  '#A9657D',
] as const

const FIXED_CATEGORY_COLORS: Record<string, string> = {
  'expense:rent': '#AB5E56',
  'expense:housing': '#A77B5A',
  'expense:groceries': '#5D8F6D',
  'expense:dining': '#D4906A',
  'expense:takeout': '#C77F4F',
  'expense:shopping': '#B77BA8',
  'expense:travel': '#7AAEC8',
  'expense:entertainment': '#9B8FC8',
  'expense:fuel': '#8F9D5A',
  'expense:public transit': '#7C8DB0',
  'expense:ride hailing': '#6F94B0',
  'expense:internet': '#5F9AB7',
  'expense:phone plan': '#648C89',
  'expense:electricity': '#C08C42',
  'expense:water': '#4F879B',
  'expense:insurance': '#8775B5',
  'expense:debt payment': '#B65F63',
  'expense:financial fees': '#9C8A4F',
  'expense:medical': '#B96773',
  'expense:health': '#C47D8A',
  'expense:education': '#A66D96',
  'expense:childcare': '#B58A78',
  'expense:pets': '#70916F',
  'expense:business expenses': '#8D7B5E',
  'income:salary': '#C9A96A',
  'income:freelance': '#5E7FA3',
  'income:bonus': '#B77BA8',
  'income:interest': '#6F9F95',
  'income:dividends': '#5D8F6D',
  'income:capital gains': '#8F9D5A',
  'income:other income': '#8C8074',
  'transfer:credit card payment': '#7C8DB0',
  'transfer:transfer': '#8C8074',
  'transfer:balance adjustment': '#A39363',
}

function hashString(value: string) {
  let hash = 2166136261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

function isSyntheticOtherCategory(id: string) {
  return id.endsWith('-other')
}

function getCategoryColorKey({ id, name }: Pick<CategoryColorInput, 'id' | 'name'>) {
  return id || name
}

function normalizeCategoryName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

function getFixedCategoryColor({ name, kind }: Pick<CategoryColorInput, 'name' | 'kind'>) {
  return FIXED_CATEGORY_COLORS[`${kind}:${normalizeCategoryName(name)}`]
}

function getPaletteColor(index: number) {
  return CURATED_CHART_COLORS[index % CURATED_CHART_COLORS.length] ?? CURATED_CHART_COLORS[0]
}

function getPreferredPaletteIndex(seed: string) {
  return hashString(seed) % CURATED_CHART_COLORS.length
}

function getColorChannels(color: string) {
  const hex = color.replace('#', '')
  const value = Number.parseInt(hex, 16)

  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  }
}

function getColorDistance(colorA: string, colorB: string) {
  const a = getColorChannels(colorA)
  const b = getColorChannels(colorB)
  const redDelta = a.r - b.r
  const greenDelta = a.g - b.g
  const blueDelta = a.b - b.b

  return Math.sqrt(redDelta * redDelta + greenDelta * greenDelta + blueDelta * blueDelta)
}

function getMinimumDistanceToUsed(index: number, usedIndexes: Set<number>) {
  if (usedIndexes.size === 0) return Number.POSITIVE_INFINITY

  return Math.min(...Array.from(usedIndexes, (usedIndex) => (
    getColorDistance(getPaletteColor(index), getPaletteColor(usedIndex))
  )))
}

function getCollisionSafePaletteIndex(preferredIndex: number, usedIndexes: Set<number>) {
  const paletteLength = CURATED_CHART_COLORS.length
  const candidates = Array.from({ length: paletteLength }, (_, attempt) => (
    (preferredIndex + attempt * PALETTE_PROBE_STEP) % paletteLength
  )).filter((index) => !usedIndexes.has(index))
  const spacedCandidate = candidates.find((index) => (
    getMinimumDistanceToUsed(index, usedIndexes) >= MIN_VISIBLE_COLOR_DISTANCE
  ))
  if (spacedCandidate !== undefined) return spacedCandidate

  const bestCandidate = candidates.reduce<{
    index: number
    distance: number
  } | null>((best, index) => {
    const distance = getMinimumDistanceToUsed(index, usedIndexes)
    if (!best || distance > best.distance) return { index, distance }

    return best
  }, null)

  return bestCandidate?.index ?? preferredIndex
}

/**
 * Orders two keys by their code units, settling a tie the same way on every device
 *
 * This is machine ordering rather than a list anyone reads, and locale-aware collation varies with the
 * browser's locale and its collation data, which would hand the same categories different colours on a
 * phone and a desktop
 */
function compareKeys(a: string, b: string) {
  if (a === b) return 0

  return a < b ? -1 : 1
}

function reserveFixedColor(color: string, usedIndexes: Set<number>) {
  const colorIndex = CURATED_CHART_COLORS.findIndex((paletteColor) => (
    paletteColor.toLowerCase() === color.toLowerCase()
  ))

  if (colorIndex >= 0) usedIndexes.add(colorIndex)
}

/**
 * Picks a palette colour for a single series, always the same colour for the same seed
 *
 * Nothing here keeps the colour apart from any other series, so anything drawing several at once uses
 * the map version instead
 */
export function getDeterministicChartColor(seed: string) {
  return getPaletteColor(getPreferredPaletteIndex(seed))
}

/**
 * Assigns a palette colour to every entry, keeping the whole set visually distinct rather than
 * colouring each one on its own
 *
 * An entry carrying a fixed colour keeps it and takes that shade out of circulation. The rest are
 * placed in an order that does not depend on how the caller sorted them, each moving along the palette
 * until it sits far enough from the colours already taken, so the same input always yields the same map
 */
export function getDeterministicChartColorMap(entries: ChartColorMapInput[]) {
  const colors = new Map<string, string>()
  const usedIndexes = new Set<number>()
  const paletteEntries = entries.filter((entry) => {
    if (!entry.fixedColor) return true

    colors.set(entry.key, entry.fixedColor)
    reserveFixedColor(entry.fixedColor, usedIndexes)
    return false
  })

  paletteEntries
    .map((entry) => {
      const hash = hashString(entry.seed)

      return {
        ...entry,
        hash,
        preferredIndex: hash % CURATED_CHART_COLORS.length,
      }
    })
    .sort((a, b) => a.preferredIndex - b.preferredIndex || a.hash - b.hash || compareKeys(a.key, b.key))
    .forEach((entry) => {
      const colorIndex = getCollisionSafePaletteIndex(entry.preferredIndex, usedIndexes)

      usedIndexes.add(colorIndex)
      colors.set(entry.key, getPaletteColor(colorIndex))
    })

  return colors
}

/**
 * Resolves the chart colour for one category, preferring a hand-picked shade over a derived one
 *
 * The seeded default categories are matched on their name and kind, so one that is deleted and
 * recreated keeps the colour a user already associates with it. Anything else is derived from its id
 */
export function getCategoryColor({ id, name, kind }: CategoryColorInput) {
  if (isSyntheticOtherCategory(id)) return OTHER_CATEGORY_COLOR

  const fixedColor = getFixedCategoryColor({ name, kind })
  if (fixedColor) return fixedColor

  return getDeterministicChartColor(`${kind}:${id || name}`)
}

/**
 * Builds the colour map for a set of categories shown together, so no two of them read as the same
 * shade
 *
 * Categories are keyed by id, falling back to their name for the grouped rows a chart synthesizes
 * rather than reads from the backend, and the rolled-up "other" bucket is pinned to its neutral grey
 */
export function getCategoryColorMap(entries: CategoryColorInput[]) {
  return getDeterministicChartColorMap(entries.map((entry) => {
    const key = getCategoryColorKey(entry)

    return {
      key,
      seed: `${entry.kind}:${key}`,
      fixedColor: isSyntheticOtherCategory(entry.id)
        ? OTHER_CATEGORY_COLOR
        : getFixedCategoryColor(entry),
    }
  }))
}
