import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Store } from 'lucide-react'
import IconTooltip from '@/components/IconTooltip'
import { formatCurrency } from '@/utils/formatCurrency'
import {
  InsightLoadingContent,
  InsightLoadingOverlay,
} from './InsightLoadingTransition'
import { SectionHeader } from './SectionHeader'
import { useInsightLoadingSnapshot } from './useInsightLoadingSnapshot'

export type MerchantMarketMerchant = {
  id: string
  name: string
  totalAmount: number
  changePct: number | null
  changeAmount: number | null
}

export type MerchantMarketTile = MerchantMarketMerchant & {
  x: number
  y: number
  width: number
  height: number
}

type MerchantMarketHover = {
  merchant: MerchantMarketTile
  x: number
  y: number
}

type MerchantDistributionCardProps = {
  merchants: MerchantMarketMerchant[]
  currency: string
  loading?: boolean
  transitionKey: string
}

type MerchantDistributionSnapshot = {
  merchants: MerchantMarketMerchant[]
  currency: string
  emptyLabel: string
}

const DEFAULT_MAP_WIDTH = 1000
const DEFAULT_MAP_HEIGHT = 460
const TOOLTIP_GAP = 10
const TOOLTIP_MARGIN = 8
const TOOLTIP_PREFERRED_WIDTH = 300

function formatSignedCurrency(amount: number, currency: string) {
  if (amount === 0) return formatCurrency(amount, currency)
  return `${amount > 0 ? '+' : '-'}${formatCurrency(Math.abs(amount), currency)}`
}

function splitTreemapItems(
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
      ...splitTreemapItems(firstGroup, x, y, firstWidth, height),
      ...splitTreemapItems(secondGroup, x + firstWidth, y, width - firstWidth, height),
    ]
  }

  const firstHeight = height * firstShare
  return [
    ...splitTreemapItems(firstGroup, x, y, width, firstHeight),
    ...splitTreemapItems(secondGroup, x, y + firstHeight, width, height - firstHeight),
  ]
}

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

function getMerchantTileColor(merchant: MerchantMarketTile) {
  if (merchant.id === 'other-merchants') {
    return 'color-mix(in srgb, var(--app-text-muted) 24%, var(--app-input-bg))'
  }
  return getMerchantMarketColor(merchant.changePct, merchant.changeAmount)
}

function MerchantDistributionLegend({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`} style={{ color: 'var(--app-text-muted)' }}>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--app-chart-positive)' }} />
        Spend down
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--app-chart-negative)' }} />
        Spend up
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--app-accent)' }} />
        Flat
      </span>
    </div>
  )
}

function MerchantMarketMap({
  merchants,
  currency,
}: {
  merchants: MerchantMarketMerchant[]
  currency: string
}) {
  const [hoveredTile, setHoveredTile] = useState<MerchantMarketHover | null>(null)
  const hoveredMerchantId = hoveredTile?.merchant.id
  const mapRef = useRef<HTMLDivElement | null>(null)
  const tooltipRef = useRef<HTMLDivElement | null>(null)
  const [mapSize, setMapSize] = useState({ width: DEFAULT_MAP_WIDTH, height: DEFAULT_MAP_HEIGHT })
  const [tooltipHeight, setTooltipHeight] = useState(96)
  const layoutWidth = Math.max(mapSize.width, 1)
  const layoutHeight = Math.max(mapSize.height, 1)
  const tooltipMaxWidth = Math.max(layoutWidth - TOOLTIP_MARGIN * 2, 1)
  const tooltipWidth = Math.min(TOOLTIP_PREFERRED_WIDTH, tooltipMaxWidth)
  const clampedTooltipHeight = Math.min(tooltipHeight, Math.max(layoutHeight - TOOLTIP_MARGIN * 2, 1))
  const tooltipLeft = hoveredTile
    ? Math.min(
        Math.max(hoveredTile.x, TOOLTIP_MARGIN + tooltipWidth / 2),
        layoutWidth - TOOLTIP_MARGIN - tooltipWidth / 2,
      )
    : 0
  const tooltipTop = hoveredTile
    ? hoveredTile.y - TOOLTIP_GAP - clampedTooltipHeight >= TOOLTIP_MARGIN
      ? hoveredTile.y - TOOLTIP_GAP - clampedTooltipHeight
      : hoveredTile.y + TOOLTIP_GAP + clampedTooltipHeight <= layoutHeight - TOOLTIP_MARGIN
        ? hoveredTile.y + TOOLTIP_GAP
        : Math.min(
            Math.max(hoveredTile.y - clampedTooltipHeight / 2, TOOLTIP_MARGIN),
            layoutHeight - TOOLTIP_MARGIN - clampedTooltipHeight,
          )
    : 0
  const laidOutMerchants = useMemo(
    () => splitTreemapItems(merchants, 0, 0, layoutWidth, layoutHeight),
    [layoutHeight, layoutWidth, merchants],
  )

  useEffect(() => {
    const element = mapRef.current
    if (!element || typeof ResizeObserver === 'undefined') return undefined

    const updateSize = (width: number, height: number) => {
      const nextWidth = Math.max(Math.round(width), 1)
      const nextHeight = Math.max(Math.round(height), 1)
      setMapSize((current) => {
        if (current.width === nextWidth && current.height === nextHeight) return current
        return { width: nextWidth, height: nextHeight }
      })
    }

    const rect = element.getBoundingClientRect()
    updateSize(rect.width, rect.height)

    const observer = new ResizeObserver(([entry]) => {
      updateSize(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current
    if (!tooltip || !hoveredMerchantId) return

    const rect = tooltip.getBoundingClientRect()
    const nextHeight = Math.max(Math.round(rect.height), 1)
    setTooltipHeight((current) => (current === nextHeight ? current : nextHeight))
  }, [currency, hoveredMerchantId])

  return (
    <div ref={mapRef} className="relative min-h-0 flex-1">
      <div className="absolute inset-0 overflow-hidden rounded-lg border border-[var(--app-border)]">
        <svg
          viewBox={`0 0 ${layoutWidth} ${layoutHeight}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Merchant market map"
          className="pointer-events-none h-full w-full"
        >
          {laidOutMerchants.map((merchant) => (
            <rect
              key={merchant.id}
              x={merchant.x + 2}
              y={merchant.y + 2}
              width={Math.max(merchant.width - 4, 0)}
              height={Math.max(merchant.height - 4, 0)}
              rx={6}
              fill={getMerchantTileColor(merchant)}
              stroke="var(--app-surface-soft)"
              strokeWidth={4}
            />
          ))}
        </svg>
        <div className="absolute inset-0">
          {laidOutMerchants.map((merchant) => {
            const area = merchant.width * merchant.height
            const labelSize = area > 110000 ? 20 : area > 42000 ? 17 : 15
            const amountSize = Math.max(labelSize - 3, 12)
            const amountText = formatCurrency(merchant.totalAmount, currency)
            const contentWidth = Math.max(merchant.width - 20, 0)
            const contentHeight = Math.max(merchant.height - 20, 0)
            const showName = contentWidth >= 80 && contentHeight >= 42
            const showAmount = contentWidth >= 70 && contentHeight >= (showName ? 62 : 30)
            const compactName = contentWidth < 128 || contentHeight < 74
            const showDetailsIndicator = !showName && !showAmount && contentWidth >= 18 && contentHeight >= 18
            const detailsIndicatorSize = Math.min(20, Math.max(15, Math.min(contentWidth, contentHeight) * 0.58))
            return (
              <div
                key={merchant.id}
                className="absolute flex min-w-0 cursor-default flex-col items-center justify-center overflow-hidden p-2 text-center"
                style={{
                  color: 'var(--app-text)',
                  left: `${(merchant.x / layoutWidth) * 100}%`,
                  top: `${(merchant.y / layoutHeight) * 100}%`,
                  width: `${(merchant.width / layoutWidth) * 100}%`,
                  height: `${(merchant.height / layoutHeight) * 100}%`,
                }}
                onMouseEnter={(event) => {
                  const rect = event.currentTarget.parentElement?.getBoundingClientRect()
                  if (!rect) return
                  setHoveredTile({
                    merchant,
                    x: event.clientX - rect.left,
                    y: event.clientY - rect.top,
                  })
                }}
                onMouseMove={(event) => {
                  const rect = event.currentTarget.parentElement?.getBoundingClientRect()
                  if (!rect) return
                  setHoveredTile({
                    merchant,
                    x: event.clientX - rect.left,
                    y: event.clientY - rect.top,
                  })
                }}
                onMouseLeave={() => setHoveredTile(null)}
              >
                {showName && (
                  <p
                    className="max-w-full overflow-hidden font-bold leading-tight"
                    style={{
                      fontSize: labelSize,
                      overflowWrap: 'normal',
                      textOverflow: 'ellipsis',
                      whiteSpace: compactName ? 'nowrap' : undefined,
                      wordBreak: 'normal',
                      ...(!compactName
                        ? {
                            display: '-webkit-box',
                            WebkitBoxOrient: 'vertical',
                            WebkitLineClamp: 2,
                          }
                        : {}),
                    }}
                  >
                    {merchant.name}
                  </p>
                )}
                {showAmount && (
                  <p
                    className={`${showName ? 'mt-1' : ''} max-w-full truncate font-financial leading-tight`}
                    style={{ color: 'var(--app-text-muted)', fontSize: amountSize }}
                  >
                    {amountText}
                  </p>
                )}
                {showDetailsIndicator && (
                  <span
                    aria-hidden
                    className="font-bold leading-none"
                    style={{ color: 'var(--app-text-muted)', fontSize: detailsIndicatorSize }}
                  >
                    ...
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
      {hoveredTile && (
        <div
          ref={tooltipRef}
          className="app-chart-tooltip-default-content pointer-events-none absolute z-20"
          style={{
            left: tooltipLeft,
            top: tooltipTop,
            width: tooltipWidth,
            transform: 'translateX(-50%)',
          }}
        >
          <p className="app-chart-tooltip-default-title">{hoveredTile.merchant.name}</p>
          <div className="mt-1 flex justify-between gap-4">
            <span className="app-chart-tooltip-default-value">Total Spend</span>
            <span className="app-chart-tooltip-default-value font-financial">
              {formatCurrency(hoveredTile.merchant.totalAmount, currency)}
            </span>
          </div>
          {hoveredTile.merchant.changeAmount === null ? (
            <p className="mt-1 text-xs" style={{ color: 'var(--app-text-muted)' }}>
              Change not shown because this group changes by period.
            </p>
          ) : (
            <div className="mt-1 flex justify-between gap-4">
              <span className="app-chart-tooltip-default-value">Change</span>
              <span className="app-chart-tooltip-default-value font-financial">
                {formatSignedCurrency(hoveredTile.merchant.changeAmount, currency)}
                {hoveredTile.merchant.changePct === null
                  ? ' (no prior spend)'
                  : ` (${hoveredTile.merchant.changePct > 0 ? '+' : ''}${hoveredTile.merchant.changePct}%)`}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function MerchantDistributionCard({
  merchants,
  currency,
  loading = false,
  transitionKey,
}: MerchantDistributionCardProps) {
  const incomingSnapshot = useMemo<MerchantDistributionSnapshot>(() => ({
    merchants,
    currency,
    emptyLabel: loading ? 'Loading merchant spending...' : 'No merchant spending in this range.',
  }), [currency, loading, merchants])
  const {
    displaySnapshot,
    contentConcealed,
    loadingVisible,
    shouldReduceMotion,
  } = useInsightLoadingSnapshot<MerchantDistributionSnapshot>({
    snapshot: incomingSnapshot,
    loading,
    transitionKey,
  })

  return (
    <div className="app-card flex h-[560px] flex-col min-[1300px]:h-full">
      <SectionHeader
        icon={Store}
        label={(
          <span className="inline-flex items-center gap-2">
            Spending Distribution by Merchant
            <IconTooltip
              label="How merchant distribution is calculated"
              placement="bottom"
              widthClassName="w-64"
            >
              Shows merchant spending after refunds. Income losses are not included.
            </IconTooltip>
          </span>
        )}
      />
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <InsightLoadingContent
          className="flex min-h-0 flex-1 flex-col"
          concealed={contentConcealed}
          shouldReduceMotion={shouldReduceMotion}
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-xs" style={{ color: 'var(--app-text-muted)' }}>
            <span>Tile size shows total spend. Dots mark tiny tiles with details available on hover.</span>
            <MerchantDistributionLegend className="hidden min-[750px]:flex" />
          </div>
          {displaySnapshot.merchants.length > 0 ? (
            <MerchantMarketMap merchants={displaySnapshot.merchants} currency={displaySnapshot.currency} />
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-[var(--app-border)] text-sm" style={{ color: 'var(--app-text-muted)' }}>
              {displaySnapshot.emptyLabel}
            </div>
          )}
          <MerchantDistributionLegend className="mt-3 justify-center text-xs min-[750px]:hidden" />
        </InsightLoadingContent>

        <InsightLoadingOverlay
          visible={loadingVisible}
          shouldReduceMotion={shouldReduceMotion}
          label="Loading merchant spending distribution"
          className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--app-surface-soft)]"
        />
      </div>
    </div>
  )
}
