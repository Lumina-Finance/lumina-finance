import { useLayoutEffect, useState, type RefObject } from 'react'
import { flushSync } from 'react-dom'

/** Marks the axis labels the width is measured from */
export const Y_AXIS_LABEL_CLASS_NAME = 'cash-flow-y-axis-label'

// Recharts draws each label this far left of the axis line, tick length plus margin, even with the
// tick lines hidden, so the axis has to be this much wider than its widest label
export const Y_AXIS_TICK_SIZE_PX = 6
export const Y_AXIS_TICK_MARGIN_PX = 2

// Keeps the plot from shifting between charts whose labels are all short, such as $0 and $1,000
const MIN_Y_AXIS_WIDTH_PX = 52

/**
 * Sizes the Y axis from the width its labels are actually drawn at. The ticks come from Recharts, which
 * rounds the range outward to even numbers, so a label can be longer than any amount in the data and
 * only the drawn labels say how wide they are
 */
export function useFittedYAxisWidth(containerRef: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(MIN_Y_AXIS_WIDTH_PX)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return undefined
    const containerElement = container

    /**
     * Fits the axis to its widest label, leaving it as it is while no label is drawn
     */
    function measure(paintAtOnce = true) {
      let widest = 0
      containerElement.querySelectorAll(`.${Y_AXIS_LABEL_CLASS_NAME}`).forEach((label) => {
        widest = Math.max(widest, label.getBoundingClientRect().width)
      })
      if (widest <= 0) return

      const nextWidth = Math.max(
        MIN_Y_AXIS_WIDTH_PX,
        Math.ceil(widest) + Y_AXIS_TICK_SIZE_PX + Y_AXIS_TICK_MARGIN_PX,
      )
      const update = () => setWidth((current) => (current === nextWidth ? current : nextWidth))
      // Rendered before the browser paints, since a frame drawn with the old width clips the labels
      // and moves the bars. The first measure runs inside an effect, which renders after it anyway
      if (paintAtOnce) flushSync(update)
      else update()
    }

    /**
     * Whether a change touched the chart's drawing, as opposed to the tooltip beside it
     */
    function isChartMutation(mutation: MutationRecord) {
      const inChart = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest('svg')
      return inChart(mutation.target) !== null
        || [...mutation.addedNodes].some((node) => node instanceof Element && (node.matches('svg') || node.querySelector('svg')))
    }

    measure(false)
    // Labels are drawn after the chart has been sized and again whenever the amounts change, and the
    // font they are measured in may arrive after they are drawn
    const mutationObserver = new MutationObserver((mutations) => {
      if (mutations.some(isChartMutation)) measure()
    })
    mutationObserver.observe(containerElement, { childList: true, subtree: true, characterData: true })
    // A taller chart draws more ticks
    const resizeObserver = new ResizeObserver(() => measure())
    resizeObserver.observe(containerElement)
    let cancelled = false
    void document.fonts?.ready.then(() => {
      if (!cancelled) measure()
    })

    return () => {
      cancelled = true
      mutationObserver.disconnect()
      resizeObserver.disconnect()
    }
  }, [containerRef])

  return width
}
