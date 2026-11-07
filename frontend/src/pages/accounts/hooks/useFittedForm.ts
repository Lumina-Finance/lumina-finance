import { useLayoutEffect, useState } from 'react'

/**
 * Picks the longest of several forms of a piece of text that keeps its line from wrapping
 *
 * The line is the element the returned ref goes on, and the piece is its descendant marked
 * `data-fitted-form`. Each form is tried, longest first, in a hidden copy of the line that never
 * wraps, and the first whose copy fits the line's width is the one shown. The index is -1 when none
 * fits, or when the line wraps even without the piece, so the caller leaves the piece out. A resize
 * or a newly loaded font decides it again
 */
export function useFittedForm(forms: string[]) {
  const [line, setLine] = useState<HTMLElement | null>(null)
  const [index, setIndex] = useState(0)
  const key = forms.join('\n')

  useLayoutEffect(() => {
    if (!line || forms.length === 0) return undefined
    const measuredLine = line

    function widthWith(text: string | null) {
      const copy = measuredLine.cloneNode(true) as HTMLElement
      const piece = copy.querySelector<HTMLElement>('[data-fitted-form]')
      if (piece) {
        if (text === null) piece.remove()
        else {
          // Shown in the copy even while the line leaves it out, so its width counts
          piece.classList.remove('hidden')
          piece.querySelector<HTMLElement>('[data-fitted-form-text]')!.textContent = text
        }
      }
      Object.assign(copy.style, {
        position: 'absolute',
        visibility: 'hidden',
        whiteSpace: 'nowrap',
        width: 'max-content',
        maxWidth: 'none',
      })
      measuredLine.after(copy)
      const width = copy.getBoundingClientRect().width
      copy.remove()
      return width
    }

    function measure() {
      const available = measuredLine.getBoundingClientRect().width
      // A line not laid out, such as one hidden, decides nothing
      if (available === 0) return
      let fitted = -1
      if (widthWith(null) <= available + 0.5) {
        fitted = forms.findIndex((form) => widthWith(form) <= available + 0.5)
      }
      setIndex(fitted)
    }

    let cancelled = false
    measure()
    void document.fonts?.ready.then(() => {
      if (!cancelled) measure()
    })
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure())
    resizeObserver?.observe(measuredLine)
    return () => {
      cancelled = true
      resizeObserver?.disconnect()
    }
    // The forms are compared by their text, since a caller builds a new list each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line, key])

  return [setLine, index] as const
}
