import { useEffect, type RefObject } from 'react'
import { useIsPresent } from 'motion/react'

/**
 * Moves focus on from a part of the Bank link section that starts to fold away with focus still in it,
 * rather than letting focus fall to the page once it has gone. A read of the link the server answered
 * once a press in the part had gone through can leave the part out before the press itself answers. The
 * part sits in an `AnimatePresence`. That says when it starts to leave
 *
 * @param moveOn - Moves focus on from the part it is given
 */
export function useMoveFocusOnFold(rootRef: RefObject<HTMLElement | null>, moveOn: (part: HTMLElement) => void): void {
  const isPresent = useIsPresent()
  useEffect(() => {
    if (!isPresent && rootRef.current?.contains(document.activeElement)) moveOn(rootRef.current)
  }, [isPresent, rootRef, moveOn])
}
