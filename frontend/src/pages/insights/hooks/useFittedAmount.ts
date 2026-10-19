import { useLayoutEffect, useState, type CSSProperties } from 'react'
import { flushSync } from 'react-dom'

/**
 * Builds the style that sizes an amount to fill its container's width, from `maxRem` down to
 * `minRem`. `fillRatio` is the font size, as a share of the container's width, at which the text
 * fills it, and null until the text is measured
 */
export function getFittedAmountStyle(fillRatio: number | null, maxRem: number, minRem: number): CSSProperties {
  return {
    // Glyph widths rounded to whole pixels at each size would make the text's width stray from
    // its font size, so a size worked out for one width could run past another
    textRendering: 'geometricPrecision',
    ...(fillRatio !== null && { fontSize: `clamp(${minRem}rem, ${fillRatio * 100}cqi, ${maxRem}rem)` }),
  }
}

/**
 * Shrinks an amount, which never wraps, until it fits its container's width
 *
 * The text keeps its class's font size, `maxRem`, while it fits. A total too long even at `minRem`
 * stays on one line at that size. The text's parent must be an inline-size container, since the
 * returned size follows the container's width in CSS. The browser then refits it in the same layout
 * that resizes the container, so no frame shows a size meant for another width, and only a new value
 * or a newly loaded font needs measuring. The fill ratio is returned for `getFittedAmountStyle`, so
 * amounts shown side by side in equal containers can share the smallest one
 */
export function useFittedAmount(value: string, maxRem: number, minRem: number) {
  // A callback ref held in state, so the fitting follows the element as it mounts and unmounts
  // (the Net Cash Flow headline is absent while its load has failed)
  const [textElement, setTextElement] = useState<HTMLParagraphElement | null>(null)
  // The font size, as a share of the container's width, at which the text fills it
  const [fillRatio, setFillRatio] = useState<number | null>(null)

  useLayoutEffect(() => {
    if (!textElement) return undefined
    const measuredTextElement = textElement

    /**
     * Measures the text at the largest allowed size, since its width grows in proportion to its
     * font size
     */
    function measure(paintAtOnce = true) {
      const { style } = measuredTextElement
      const previousStyle = { fontSize: style.fontSize, width: style.width, maxWidth: style.maxWidth }
      // Sized to its text for the measure, which can be narrower or wider than its container
      Object.assign(style, { fontSize: `${maxRem}rem`, width: 'max-content', maxWidth: 'none' })
      // A fractional width, since a whole-pixel one can fall up to a pixel short of the text and let the
      // fitted size run past the container by a fraction of a pixel
      const textWidth = measuredTextElement.getBoundingClientRect().width
      const fontSizePx = parseFloat(getComputedStyle(measuredTextElement).fontSize)
      Object.assign(style, previousStyle)

      const nextFillRatio = textWidth > 0 ? fontSizePx / textWidth : null
      const update = () => setFillRatio(nextFillRatio)
      // Rendered before the browser paints, since a frame drawn with the old measurement shows the
      // text at a size fitted for another text or font. The first measure runs inside a layout
      // effect, which renders before the paint anyway
      if (paintAtOnce) flushSync(update)
      else update()
    }

    measure(false)
    let cancelled = false
    // The font the amount is measured in may arrive after it is drawn
    void document.fonts?.ready.then(() => {
      if (!cancelled) measure()
    })

    return () => {
      cancelled = true
    }
  }, [textElement, value, maxRem, minRem])

  return [setTextElement, fillRatio] as const
}
