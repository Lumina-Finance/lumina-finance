import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

// The crossfade clips a label at its own edges, so a label fitted exactly would lose the overhang of its first
// and last letters. A few pixels of room keeps them whole
const LABEL_SLACK_PX = 4

// What a button adds around its label, read from its own computed style
const BUTTON_CHROME_PROPERTIES = ['padding-left', 'padding-right', 'border-left-width', 'border-right-width']

/**
 * Measures a button's one label, so the button can keep that width while a spinner or a check replaces
 * the label. An automatic width would shrink to the replacement, and a fixed width guessed per label
 * leaves room to spare
 *
 * It fits the one label it is given and reserves no room for any other. A button whose label changes
 * takes an automatic width and crossfades its labels instead, such as through `PendingLabel`'s
 * `contentKey`
 *
 * The button takes `buttonRef` and `style`, uses `sm:w-(--fit-width)` wherever it would otherwise
 * have a fixed width, and renders `measure` inside itself so the label is measured in its own font.
 * `renderLabel` draws the label as the button does, for one that sets an icon beside its text
 */
export function useFittedButtonWidth(label: string, renderLabel: (label: string) => ReactNode = (text) => text) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const [width, setWidth] = useState<number | null>(null)

  useLayoutEffect(() => {
    let cancelled = false
    const measure = () => {
      const button = buttonRef.current
      const measured = measureRef.current
      if (cancelled || !button || !measured) return

      const style = window.getComputedStyle(button)
      const chrome = BUTTON_CHROME_PROPERTIES.reduce(
        (total, property) => total + (Number.parseFloat(style.getPropertyValue(property)) || 0),
        0,
      )
      setWidth(Math.ceil(measured.getBoundingClientRect().width + chrome) + LABEL_SLACK_PX)
    }
    measure()

    // A label measured before the web font arrives comes out narrower than it renders
    void document.fonts?.ready.then(measure)
    return () => {
      cancelled = true
    }
  }, [label])

  return {
    buttonRef,
    style: (width === null ? undefined : { '--fit-width': `${width}px` }) as CSSProperties | undefined,
    measure: (
      <span ref={measureRef} className="pointer-events-none invisible absolute left-0 top-0" aria-hidden>
        <span className="flex w-max items-center gap-2 whitespace-nowrap">{renderLabel(label)}</span>
      </span>
    ),
  }
}
