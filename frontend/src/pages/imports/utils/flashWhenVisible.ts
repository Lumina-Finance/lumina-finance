/**
 * What `startWhenVisible` needs of the page, which the document provides
 */
export type VisibilitySource = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>

/**
 * Starts something once the page has been in view for a pause
 *
 * The pause begins when the page is in view and starts over each time it comes back into view, so a
 * tab that gets what the user should see while it is in the background keeps it for when they look
 * rather than spending it unseen
 *
 * @param source - The page, whose visibility is watched
 * @param pauseMs - How long the page must stay in view before `start` runs
 * @param start - Runs once
 * @returns Stops the wait, for a cleanup that runs before it started
 */
export function startWhenVisible(source: VisibilitySource, pauseMs: number, start: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined

  function stopWaiting() {
    clearTimeout(timer)
    timer = undefined
  }

  function waitInView() {
    stopWaiting()
    if (source.visibilityState !== 'visible') return
    timer = setTimeout(() => {
      source.removeEventListener('visibilitychange', waitInView)
      start()
    }, pauseMs)
  }

  source.addEventListener('visibilitychange', waitInView)
  waitInView()

  return () => {
    stopWaiting()
    source.removeEventListener('visibilitychange', waitInView)
  }
}
