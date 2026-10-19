import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { ImportDateRange } from '@/pages/imports/types'
import { getNextImportDateRange, WHOLE_FILE_DATE_RANGE } from '@/pages/imports/utils/dateRange'

// The group holding the date fields carries this attribute, which is how the page finds them to tell
// editing from leaving
const DATES_SELECTOR = '[data-import-dates]'

// A date field's calendar is open while its button says so. It lies outside the group, in a portal,
// so what is inside it is told apart as a dialog the group's own button has opened
const OPEN_CALENDAR_SELECTOR = '[aria-haspopup="dialog"][aria-expanded="true"]'

/**
 * The dates and whether a calendar is open, read from the page rather than tracked, since a focused
 * element that is removed fires no blur and a calendar's focus leaves the group
 */
function readDates() {
  const dates = document.querySelector(DATES_SELECTOR)
  return { dates, isCalendarOpen: dates?.querySelector(OPEN_CALENDAR_SELECTOR) != null }
}

function isWithinDates(node: EventTarget | null): boolean {
  const { dates, isCalendarOpen } = readDates()
  if (!dates || !(node instanceof Element)) return false
  return dates.contains(node) || (isCalendarOpen && node.closest('[role="dialog"]') !== null)
}

/**
 * Holds the dates an import is limited to as two ranges: the one the fields show, which changes at
 * once, and the one the rest of the page reads, which follows once editing ends
 *
 * The page walks every row of the file whenever the range it reads changes, which stalls the
 * fields' own animations, so it is kept from doing that while the dates are being edited. Editing
 * ends, and the page takes the range on screen in one render, when:
 *
 * - a mouse leaves the setup panel, unless a calendar is open, whose grid lies outside the panel
 * - anything outside the dates and an open calendar is pressed, typed on or focused, which is how
 *   keyboard and touch users leave, and what Commit import, another step and another file all are,
 *   so none of them can reach a page holding an earlier range
 * - a change is made with the pointer and focus both elsewhere, which has no end to wait for
 *
 * The render is made at once, not batched, so what the user does next is read from the new range
 */
export function useImportDateRange() {
  const [dateRange, setDateRange] = useState<ImportDateRange>(WHOLE_FILE_DATE_RANGE)
  const [shownDateRange, setShownDateRange] = useState<ImportDateRange>(WHOLE_FILE_DATE_RANGE)
  const shownRef = useRef(shownDateRange)
  const appliedRef = useRef(dateRange)
  const isPointerInPanelRef = useRef(false)

  const applyDateRange = useCallback(() => {
    if (appliedRef.current === shownRef.current) return false
    appliedRef.current = shownRef.current
    flushSync(() => setDateRange(shownRef.current))
    return true
  }, [])

  const showDateRange = (next: ImportDateRange) => {
    shownRef.current = next
    setShownDateRange(next)
  }

  useEffect(() => {
    const applyWhenOutsideDates = (event: Event) => {
      if (!isWithinDates(event.target)) applyDateRange()
    }
    const events = ['pointerdown', 'keydown', 'focusin'] as const
    for (const type of events) document.addEventListener(type, applyWhenOutsideDates, true)

    // A calendar picked from with the mouse leaves nothing else to end the editing: the pointer left
    // the panel for the calendar while it was open, and focus returns to the field. So a calendar
    // closing with the mouse off the panel ends it
    const applyWhenCalendarCloses = () => {
      if (!isPointerInPanelRef.current && !readDates().isCalendarOpen) applyDateRange()
    }
    const observer = new MutationObserver(applyWhenCalendarCloses)
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-expanded'] })
    return () => {
      for (const type of events) document.removeEventListener(type, applyWhenOutsideDates, true)
      observer.disconnect()
    }
  }, [applyDateRange])

  return {

    /** What the rest of the page reads */
    dateRange,

    /** What the fields show */
    shownDateRange,

    /**
     * Makes the page read what the fields show
     *
     * @returns Whether it had been reading something else, which the caller's own render still holds
     */
    applyDateRange,
    setDateRangeEnd: (end: keyof ImportDateRange, value: string, isPartlyTyped: boolean) => {
      showDateRange(getNextImportDateRange(shownRef.current, end, value, isPartlyTyped))
      const { dates, isCalendarOpen } = readDates()
      if (!isPointerInPanelRef.current && !isCalendarOpen && !dates?.contains(document.activeElement)) applyDateRange()
    },
    resetDateRange: () => {
      showDateRange(WHOLE_FILE_DATE_RANGE)
      appliedRef.current = WHOLE_FILE_DATE_RANGE
      setDateRange(WHOLE_FILE_DATE_RANGE)
    },
    setIsPointerInDatePanel: (isInside: boolean) => {
      isPointerInPanelRef.current = isInside
      if (!isInside && !readDates().isCalendarOpen) applyDateRange()
    },
  }
}
