import { useLayoutEffect, useState, type CSSProperties } from 'react'
import { flushSync } from 'react-dom'

// How long a container's width must stay put before an amount changes between its full and compact form
const FORM_SETTLE_MS = 200

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
 * The text keeps its class's font size, `maxRem`, while it fits. A total too wide for its container
 * even at `minRem` is shown as `compactValue` instead, fitted the same way. Whether it was is the
 * hook's third value, so the caller can keep the full amount reachable. A change of form waits until
 * the container's width has stayed put for a moment, so a layout moving around it shows no flicker.
 * The text's parent must be an inline-size container, since the returned size follows the
 * container's width in CSS. The browser then refits it in the same layout that resizes the
 * container, so no frame shows a size meant for another width, and only a new value or a newly
 * loaded font needs measuring. The fill ratio is returned for `getFittedAmountStyle`, so amounts
 * shown side by side in equal containers can share the smallest one
 */
export function useFittedAmount(value: string, compactValue: string, maxRem: number, minRem: number) {
  // A callback ref held in state, so the fitting follows the element as it mounts and unmounts
  // (the Net cash flow headline is absent while its load has failed)
  const [textElement, setTextElement] = useState<HTMLParagraphElement | null>(null)
  // The font size, as a share of the container's width, at which the shown text fills it, and
  // whether the shown text is the compact form
  const [fit, setFit] = useState<{ fillRatio: number | null; compact: boolean }>({ fillRatio: null, compact: false })

  useLayoutEffect(() => {
    if (!textElement) return undefined
    const measuredTextElement = textElement
    const container = measuredTextElement.parentElement

    /**
     * Measures a text at the largest allowed size, in a hidden copy of the element so the text on
     * show stays as it is, since a text's width grows in proportion to its font size
     */
    function measureText(text: string) {
      const copy = measuredTextElement.cloneNode(false) as HTMLParagraphElement
      copy.textContent = text
      // The copy is measured at `maxRem`, so it never takes the size of an amount waiting to turn compact
      for (const name of ['data-fit-pending', 'data-fit-swap']) copy.removeAttribute(name)
      copy.style.removeProperty('--fit-pending-size')
      // Sized to its text for the measure, which can be narrower or wider than its container
      Object.assign(copy.style, {
        fontSize: `${maxRem}rem`,
        width: 'max-content',
        maxWidth: 'none',
        position: 'absolute',
        visibility: 'hidden',
      })
      measuredTextElement.after(copy)
      // A fractional width, since a whole-pixel one can fall up to a pixel short of the text and let the
      // fitted size run past the container by a fraction of a pixel
      const width = copy.getBoundingClientRect().width
      const fontSizePx = parseFloat(getComputedStyle(copy).fontSize)
      copy.remove()
      return { width, fontSizePx }
    }

    /**
     * Fits the full text when it fits its container at `minRem`, and the compact form otherwise
     */
    function measure(paintAtOnce = true, settled = false) {
      const full = measureText(value)
      const containerWidth = container?.getBoundingClientRect().width ?? 0
      // An amount with no shorter form, such as one under a million, stays in full
      const wantsCompact =
        full.width > 0 &&
        containerWidth > 0 &&
        compactValue !== value &&
        full.width * (minRem / maxRem) > containerWidth + 0.01
      // A container passes through odd widths while the page around it moves, such as the layout
      // sliding on a window resize, so a form that differs from the one shown waits until the width
      // has stayed put, and the form shown keeps fitting meanwhile
      // Changing means the wanted form differs from the one shown
      const changing = shownCompact !== null && wantsCompact !== shownCompact
      if (changing && !settled) {
        clearTimeout(settleTimer)
        settleTimer = setTimeout(() => {
          settleTimer = undefined
          if (!cancelled) measure(true, true)
        }, FORM_SETTLE_MS)
      } else if (!changing && settleTimer !== undefined) {
        clearTimeout(settleTimer)
        settleTimer = undefined
      }
      const compact = changing && !settled ? !wantsCompact : wantsCompact
      // A form that changes under the user's eyes, such as on a window resize, fades in. This
      // attribute names the form it changed to and picks the animation, and the attribute clears when
      // the animation ends, so each change plays one and a form shown from the start plays none
      if (shownCompact !== null && shownCompact !== compact) {
        measuredTextElement.setAttribute('data-fit-swap', compact ? 'to-compact' : 'to-full')
      }
      // A measure of an unmeasurable element, such as one hidden or not yet laid out, decides nothing,
      // so the first real measure shows its form at once rather than fading it in
      if (full.width > 0 && containerWidth > 0) shownCompact = compact
      const shown = compact ? measureText(compactValue) : full
      const fillRatio = shown.width > 0 ? shown.fontSizePx / shown.width : null
      // A full amount waiting to turn compact is too wide even at `minRem`, so until it changes it
      // is sized to fill the container, below `minRem`, and never runs past it
      if (changing && !settled && wantsCompact && fillRatio !== null) {
        measuredTextElement.setAttribute('data-fit-pending', '')
        measuredTextElement.style.setProperty('--fit-pending-size', `${fillRatio * 100}cqi`)
      } else if (measuredTextElement.hasAttribute('data-fit-pending')) {
        measuredTextElement.removeAttribute('data-fit-pending')
        measuredTextElement.style.removeProperty('--fit-pending-size')
      }

      const update = () =>
        setFit((previous) =>
          previous.fillRatio === fillRatio && previous.compact === compact ? previous : { fillRatio, compact },
        )
      // Rendered before the browser paints, since a frame drawn with the old measurement shows the
      // text at a size fitted for another text or font. The first measure runs inside a layout
      // effect, which renders before the paint anyway
      if (paintAtOnce) flushSync(update)
      else update()
    }

    let shownCompact: boolean | null = null
    let settleTimer: ReturnType<typeof setTimeout> | undefined
    let cancelled = false
    measure(false)
    // The font the amount is measured in may arrive after it is drawn
    void document.fonts?.ready.then(() => {
      if (!cancelled) measure()
    })
    // Which form fits depends on the container's width, so a resize decides it again
    const resizeObserver =
      typeof ResizeObserver === 'undefined' || !container ? null : new ResizeObserver(() => measure())
    if (container) resizeObserver?.observe(container)
    const clearSwap = () => measuredTextElement.removeAttribute('data-fit-swap')
    measuredTextElement.addEventListener('animationend', clearSwap)

    return () => {
      cancelled = true
      measuredTextElement.removeEventListener('animationend', clearSwap)
      clearSwap()
      clearTimeout(settleTimer)
      resizeObserver?.disconnect()
    }
  }, [textElement, value, compactValue, maxRem, minRem])

  return [setTextElement, fit.fillRatio, fit.compact] as const
}
