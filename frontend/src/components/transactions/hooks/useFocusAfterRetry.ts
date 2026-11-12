import { useEffect, useRef, type RefObject } from 'react'

/**
 * Moves focus to what takes a failure's place once its read succeeds, when the failure's retry had
 * focus, since the retry leaves with the failure and would otherwise drop focus to the top of the page
 *
 * The failure is still on its way out as the success renders, so whether its retry has focus can be
 * read then
 */
export function useFocusAfterRetry(
  failed: boolean,
  failureRef: RefObject<HTMLElement | null>,
  getTarget: () => HTMLElement | null | undefined,
) {
  const wasFailed = useRef(failed)
  useEffect(() => {
    const succeeded = wasFailed.current && !failed
    wasFailed.current = failed
    if (succeeded && failureRef.current?.contains(document.activeElement)) getTarget()?.focus({ preventScroll: true })
  }, [failed, failureRef, getTarget])
}
