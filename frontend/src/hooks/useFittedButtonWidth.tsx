import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

// What a button adds around its label, read from its own computed style
const BUTTON_CHROME_PROPERTIES = ['padding-left', 'padding-right', 'border-left-width', 'border-right-width']

/**
 * Sizes a button to its label, as a width it can animate from when it shrinks into its loading
 * spinner. An automatic width cannot animate, and a fixed one guessed per label leaves room to spare
 *
 * Given every label the button can show, such as Sync now and Syncing, it takes the widest of them,
 * so it keeps one width while its label changes and nothing beside it shifts. Given one label, a new
 * label animates the width to the new one
 *
 * The button takes `buttonRef` and `style`, uses `sm:w-(--fit-width)` wherever it would otherwise
 * have a fixed width, and renders `measure` inside itself so each label is measured in its own font.
 * `renderLabel` draws a label as the button does, for one that sets an icon beside its text
 */
export function useFittedButtonWidth(
  labels: string | readonly string[],
  renderLabel: (label: string) => ReactNode = (label) => label,
) {
  const labelList = typeof labels === 'string' ? [labels] : labels
  const labelsKey = labelList.join('\n')
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
      const widest = Math.max(0, ...Array.from(measured.children, (label) => label.getBoundingClientRect().width))
      setWidth(Math.ceil(widest + chrome))
    }
    measure()

    // A label measured before the web font arrives comes out narrower than it renders
    void document.fonts?.ready.then(measure)
    return () => {
      cancelled = true
    }
  }, [labelsKey])

  return {
    buttonRef,
    style: (width === null ? undefined : { '--fit-width': `${width}px` }) as CSSProperties | undefined,
    measure: (
      <span ref={measureRef} className="pointer-events-none invisible absolute left-0 top-0" aria-hidden>
        {labelList.map((label) => (
          <span key={label} className="flex w-max items-center gap-2 whitespace-nowrap">
            {renderLabel(label)}
          </span>
        ))}
      </span>
    ),
  }
}
