import { useState } from 'react'
import type { ReactNode } from 'react'
import { formatCurrency } from '@/utils/formatCurrency'

export type MerchantMarketTile = {
  id: string
  name: string
  totalAmount: number
  x: number
  y: number
  width: number
  height: number
  changePct: number | null
  changeAmount: number | null
}

type MerchantMarketHover = {
  merchant: MerchantMarketTile
  x: number
  y: number
}

type MerchantDistributionCardProps = {
  header: ReactNode
  merchants: MerchantMarketTile[]
  currency: string
  emptyLabel?: string
}

function formatSignedCurrency(amount: number, currency: string) {
  if (amount === 0) return formatCurrency(amount, currency)
  return `${amount > 0 ? '+' : '-'}${formatCurrency(Math.abs(amount), currency)}`
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

function MerchantMarketMap({
  merchants,
  currency,
}: {
  merchants: MerchantMarketTile[]
  currency: string
}) {
  const [hoveredTile, setHoveredTile] = useState<MerchantMarketHover | null>(null)

  return (
    <div className="relative min-h-0 flex-1">
      <div className="h-full overflow-hidden rounded-lg border border-[var(--app-border)]">
        <svg
          viewBox="0 0 1000 460"
          preserveAspectRatio="none"
          role="img"
          aria-label="Merchant market map"
          className="h-full w-full"
        >
          {merchants.map((merchant) => {
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
              <g
                key={merchant.id}
                onMouseEnter={(event) => {
                  const rect = event.currentTarget.ownerSVGElement?.getBoundingClientRect()
                  if (!rect) return
                  setHoveredTile({
                    merchant,
                    x: event.clientX - rect.left,
                    y: event.clientY - rect.top,
                  })
                }}
                onMouseMove={(event) => {
                  const rect = event.currentTarget.ownerSVGElement?.getBoundingClientRect()
                  if (!rect) return
                  setHoveredTile({
                    merchant,
                    x: event.clientX - rect.left,
                    y: event.clientY - rect.top,
                  })
                }}
                onMouseLeave={() => setHoveredTile(null)}
              >
                <rect
                  x={merchant.x + 2}
                  y={merchant.y + 2}
                  width={Math.max(merchant.width - 4, 0)}
                  height={Math.max(merchant.height - 4, 0)}
                  rx={6}
                  fill={getMerchantTileColor(merchant)}
                  stroke="var(--app-surface-soft)"
                  strokeWidth={4}
                />
                <foreignObject
                  x={merchant.x + 10}
                  y={merchant.y + 10}
                  width={contentWidth}
                  height={contentHeight}
                >
                  <div
                    className="flex h-full min-w-0 flex-col items-center justify-center overflow-hidden text-center"
                    style={{ color: 'var(--app-text)' }}
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
                </foreignObject>
              </g>
            )
          })}
        </svg>
      </div>
      {hoveredTile && (
        <div
          className="app-chart-tooltip-default-content pointer-events-none absolute z-20 min-w-56"
          style={{
            left: hoveredTile.x,
            top: hoveredTile.y,
            transform: 'translate(-50%, calc(-100% - 10px))',
          }}
        >
          <p className="app-tooltip-muted">{hoveredTile.merchant.name}</p>
          <div className="mt-1 flex justify-between gap-4">
            <span>Total Spend</span>
            <span className="font-financial">{formatCurrency(hoveredTile.merchant.totalAmount, currency)}</span>
          </div>
          {hoveredTile.merchant.changeAmount === null ? (
            <p className="mt-1 text-xs" style={{ color: 'var(--app-text-muted)' }}>
              Change not shown because this group changes by period.
            </p>
          ) : (
            <div className="mt-1 flex justify-between gap-4">
              <span>Change</span>
              <span className="font-financial">
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
  header,
  merchants,
  currency,
  emptyLabel = 'No merchant spending in this range.',
}: MerchantDistributionCardProps) {
  return (
    <div className="app-card flex min-h-[560px] flex-col">
      {header}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-xs" style={{ color: 'var(--app-text-muted)' }}>
        <span>Tile size shows total spend. Dots mark tiny tiles with details available on hover.</span>
        <div className="flex flex-wrap items-center gap-3">
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
      </div>
      {merchants.length > 0 ? (
        <MerchantMarketMap merchants={merchants} currency={currency} />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-[var(--app-border)] text-sm" style={{ color: 'var(--app-text-muted)' }}>
          {emptyLabel}
        </div>
      )}
    </div>
  )
}
