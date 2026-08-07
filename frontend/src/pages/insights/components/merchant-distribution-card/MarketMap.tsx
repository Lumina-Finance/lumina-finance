import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ChartTooltipRow, ChartTooltipTitle } from '@/components/charts/TooltipContent'
import CursorTooltipPortal from '@/components/charts/CursorTooltipPortal'
import { useCursorTooltip } from '@/hooks/useCursorTooltip'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import type {
  MerchantMarketMerchant,
  MerchantMarketTile,
} from '@/pages/insights/types/merchantDistribution'
import {
  getMerchantTileColor,
  splitMerchantTreemapItems,
} from '@/pages/insights/utils/merchantDistributionMap'
import { formatSignedCurrency } from '@/pages/insights/utils/money'

type MerchantMarketMapProps = {
  merchants: MerchantMarketMerchant[]
  currency: string
}

const DEFAULT_MAP_WIDTH = 1000
const DEFAULT_MAP_HEIGHT = 460
const TOOLTIP_MARGIN = 8
const TOOLTIP_PREFERRED_WIDTH = 300

/**
 * Renders the merchant spending treemap and owns cursor tooltip behaviour
 */
export function MerchantMarketMap({
  merchants,
  currency,
}: MerchantMarketMapProps) {
  const mapRef = useRef<HTMLDivElement | null>(null)
  const { currencies, formatCurrency } = useMoneyFormatters()
  const {
    tooltipRef,
    tooltipItem: hoveredMerchant,
    tooltipVisible,
    showTooltip: showMerchantTooltip,
    hideTooltip,
    handleTooltipTransitionEnd,
  } = useCursorTooltip<MerchantMarketTile, HTMLDivElement>({
    originRef: mapRef,
    xProperty: '--merchant-tooltip-x',
    yProperty: '--merchant-tooltip-y',
    getItemKey: (merchant) => merchant.id,
  })
  const [mapSize, setMapSize] = useState({ width: DEFAULT_MAP_WIDTH, height: DEFAULT_MAP_HEIGHT })
  const layoutWidth = Math.max(mapSize.width, 1)
  const layoutHeight = Math.max(mapSize.height, 1)
  const tooltipMaxWidth = Math.max(layoutWidth - TOOLTIP_MARGIN * 2, 1)
  const tooltipWidth = Math.min(TOOLTIP_PREFERRED_WIDTH, tooltipMaxWidth)
  const laidOutMerchants = useMemo(
    () => splitMerchantTreemapItems(merchants, 0, 0, layoutWidth, layoutHeight),
    [layoutHeight, layoutWidth, merchants],
  )

  useEffect(() => {
    const element = mapRef.current
    if (!element || typeof ResizeObserver === 'undefined') return undefined

    /**
     * Normalizes measured map dimensions before they drive the treemap layout
     */
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

  return (
    <div
      ref={mapRef}
      className="relative min-h-0 flex-1"
      onMouseLeave={hideTooltip}
    >
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
                onMouseEnter={(event) => showMerchantTooltip(merchant, event)}
                onMouseMove={(event) => showMerchantTooltip(merchant, event)}
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
      <CursorTooltipPortal
        ref={tooltipRef}
        onTransitionEnd={handleTooltipTransitionEnd}
        style={{
          opacity: tooltipVisible ? 1 : 0,
          transform: 'translate3d(var(--merchant-tooltip-x, 0px), var(--merchant-tooltip-y, 0px), 0)',
          width: tooltipWidth,
        }}
      >
        {hoveredMerchant && (
          <>
            <ChartTooltipTitle>{hoveredMerchant.name}</ChartTooltipTitle>
            <ChartTooltipRow
              label="Total Spend"
              value={formatCurrency(hoveredMerchant.totalAmount, currency)}
              financialValue
            />
            {hoveredMerchant.changeAmount !== null && (
              <ChartTooltipRow
                label="Change"
                value={(
                  <>
                    {formatSignedCurrency(hoveredMerchant.changeAmount, currency, currencies)}
                    {hoveredMerchant.changePct === null
                      ? ''
                      : ` (${hoveredMerchant.changePct > 0 ? '+' : ''}${hoveredMerchant.changePct}%)`}
                  </>
                )}
                financialValue
              />
            )}
          </>
        )}
      </CursorTooltipPortal>
    </div>
  )
}
