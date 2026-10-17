import { useEffect, useRef } from 'react'

/**
 * Keeps the keyboard's place while files are staged into and removed from a list that sits above its
 * upload card
 *
 * @param files - The staged files, in the order the list draws them
 * @param removeFile - Takes a file out of the import
 * @returns The refs for the list's element and the upload card's button, and a remove that moves
 *   focus before the file goes
 */
export function useStagedFileFocus(files: Array<{ id: string }>, removeFile: (fileId: string) => void) {
  const stagedListRef = useRef<HTMLDivElement>(null)
  const uploadCardRef = useRef<HTMLButtonElement>(null)
  const isFileStaged = files.length > 0
  const wasFileStagedRef = useRef(isFileStaged)

  // The upload card is what the keyboard user pressed to get here, so taking it away leaves them on
  // the page body with the next tab starting from the top. The staged row's Remove button is the
  // control that replaced it, and it is the first button the list holds. Focus is only taken back
  // where the browser dropped it, so a user who moved on while the file was being read keeps where
  // they are
  useEffect(() => {
    const hasJustBeenStaged = isFileStaged && !wasFileStagedRef.current
    wasFileStagedRef.current = isFileStaged
    if (!hasJustBeenStaged || document.activeElement !== document.body) return
    stagedListRef.current?.querySelector('button')?.focus()
  }, [isFileStaged])

  // Removing a file takes the focused Remove button away, which would leave the keyboard user on the
  // page body once the row has collapsed. Focus moves as the row starts leaving, to the next file's
  // Remove button, or the previous one's when the last row went, or to the upload card when no file
  // is left. A click leaves focus alone, since the pointer's user has no place to keep
  const isUploadCardDueFocusRef = useRef(false)
  const removeFileKeepingFocus = (fileId: string) => {
    const list = stagedListRef.current
    if (list?.contains(document.activeElement)) {
      const buttons = Array.from(list.querySelectorAll<HTMLButtonElement>('button[aria-label^="Remove "]'))
      const index = files.findIndex((staged) => staged.id === fileId)
      const neighbour = buttons[index + 1] ?? buttons[index - 1]
      if (neighbour) neighbour.focus()
      else isUploadCardDueFocusRef.current = true
    }
    removeFile(fileId)
  }

  useEffect(() => {
    if (files.length > 0 || !isUploadCardDueFocusRef.current) return
    isUploadCardDueFocusRef.current = false
    uploadCardRef.current?.focus()
  }, [files.length])

  return { stagedListRef, uploadCardRef, removeFileKeepingFocus }
}
