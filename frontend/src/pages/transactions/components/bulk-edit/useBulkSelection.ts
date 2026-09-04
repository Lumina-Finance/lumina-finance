import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import {
  bulkSelectionReducer,
  emptyBulkSelection,
  groupSelectionMark,
  previewSelection,
  rowSelectionMark,
  type BulkSelectionAction,
  type BulkSelectionState,
  type GroupSelectionMark,
  type RowSelectionMark,
  type SelectableRow,
} from '@/pages/transactions/components/bulk-edit/selection'
import { MAX_BULK_EDIT_TRANSACTIONS } from '@/pages/transactions/components/bulk-edit/constants'

/**
 * Holds which transactions a bulk edit covers, and lights the rows a pending shift-click or day tick
 * would take.
 *
 * @param rows The rows on screen, in the order they appear, which is what a range runs along
 * @param requestKey Identifies the list being shown, so the selection empties when the list changes
 * @param isSettled False while the list is mid-change and still showing its previous rows
 * @param limit How many rows one bulk edit may cover, so a test can use a small one
 */
export function useBulkSelection(
  rows: SelectableRow[],
  requestKey: string,
  isSettled: boolean,
  limit: number = MAX_BULK_EDIT_TRANSACTIONS,
) {
  const [state, dispatch] = useReducer(
    (current: BulkSelectionState, action: BulkSelectionAction) => bulkSelectionReducer(current, action, limit),
    emptyBulkSelection,
  )

  // Read at dispatch time rather than closed over, so a range always runs along the rows on screen
  const rowsRef = useRef(rows)
  useEffect(() => {
    rowsRef.current = rows
  }, [rows])

  // The row the pointer is over, held whether or not shift is down, so pressing shift without
  // moving the pointer lights the range straight away
  const pointerRowRef = useRef<string | null>(null)
  const shiftHeldRef = useRef(false)

  // A filter or a search empties the selection, since the rows it pointed at are no longer the rows
  // on screen
  useEffect(() => {
    dispatch({ type: 'clear' })
  }, [requestKey])

  const displayedIds = useMemo(() => rows.map((row) => row.id), [rows])

  useEffect(() => {
    if (!isSettled) return
    dispatch({ type: 'keepDisplayed', ids: displayedIds })
  }, [displayedIds, isSettled])

  useEffect(() => {
    function clearRangePreview() {
      shiftHeldRef.current = false
      dispatch({ type: 'hover', id: null })
    }

    // Leaving the page takes the pointer with it, so the day heading it was resting on stops being
    // hovered as well. Releasing shift does not, since a day preview never depended on shift
    function clearEveryPreview() {
      clearRangePreview()
      dispatch({ type: 'hoverGroup', ids: null })
    }

    // The search box sits directly above the list, so a capital letter typed there would otherwise
    // light the rows under the pointer
    function isShiftMeantForSomethingElse() {
      const active = document.activeElement as HTMLElement | null
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
        return true
      }
      return document.querySelector('[role="dialog"]') !== null
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Shift' || isShiftMeantForSomethingElse()) return
      shiftHeldRef.current = true
      if (pointerRowRef.current !== null) dispatch({ type: 'hover', id: pointerRowRef.current })
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (event.key !== 'Shift') return
      clearRangePreview()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    // A shift released in another application never reaches this page, so the flag would otherwise
    // stay set and promise a range the click would not take
    window.addEventListener('blur', clearEveryPreview)
    document.addEventListener('visibilitychange', clearEveryPreview)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', clearEveryPreview)
      document.removeEventListener('visibilitychange', clearEveryPreview)
    }
  }, [])

  const preview = useMemo(() => previewSelection(state, rows, limit), [state, rows, limit])

  const markFor = useCallback(
    (id: string): RowSelectionMark => rowSelectionMark(id, state.selectedIds, preview),
    [state.selectedIds, preview],
  )

  // Read against the ticks as they stand rather than against the preview, so resting the pointer on
  // a day heading does not show its tick already taken
  const groupMarkFor = useCallback(
    (ids: string[]): GroupSelectionMark => groupSelectionMark(ids, rows, state.selectedIds, limit),
    [rows, state.selectedIds, limit],
  )

  const toggle = useCallback((id: string, withShift: boolean) => {
    dispatch({ type: withShift ? 'extend' : 'toggle', id, rows: rowsRef.current })
  }, [])

  const toggleGroup = useCallback((ids: string[], options?: { clearsHover?: boolean }) => {
    dispatch({ type: 'toggleGroup', ids, rows: rowsRef.current, clearsHover: options?.clearsHover })
  }, [])

  const handlePointerEnter = useCallback((id: string) => {
    pointerRowRef.current = id
    if (shiftHeldRef.current) dispatch({ type: 'hover', id })
  }, [])

  // Taken on a move rather than on entry, because a sticky heading travels under a still pointer
  // while the list scrolls, and every day it passed would otherwise light its rows in turn
  const handleGroupPointerMove = useCallback((ids: string[]) => {
    pointerRowRef.current = null
    dispatch({ type: 'hoverGroup', ids })
  }, [])

  const handleGroupPointerLeave = useCallback(() => {
    dispatch({ type: 'hoverGroup', ids: null })
  }, [])

  const handlePointerLeaveList = useCallback(() => {
    pointerRowRef.current = null
    dispatch({ type: 'hover', id: null })
    dispatch({ type: 'hoverGroup', ids: null })
  }, [])

  const clear = useCallback(() => {
    pointerRowRef.current = null
    shiftHeldRef.current = false
    dispatch({ type: 'clear' })
  }, [])

  const selectedIds = useMemo(() => [...state.selectedIds], [state.selectedIds])

  return {
    selectedIds,
    markFor,
    groupMarkFor,
    toggle,
    toggleGroup,
    handlePointerEnter,
    handleGroupPointerMove,
    handleGroupPointerLeave,
    handlePointerLeaveList,
    clear,
  }
}
