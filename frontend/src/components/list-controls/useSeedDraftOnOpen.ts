import { useState } from 'react'

/**
 * Seeds a filter draft from the applied filters each time a surface opens on an `isOpen` prop
 *
 * @param isOpen - Whether the surface is open, counting the mount it opens on as a rising edge
 * @param seedDraft - Copies the applied filters into the draft
 */
export function useSeedDraftOnOpen(isOpen: boolean, seedDraft: () => void): void {
  // Call this from the component owning the draft. The state below lands on the calling component,
  // so seeding from one of its children would update a different component mid-render, which React
  // logs an error for and then defers past the paint this exists to precede. The desktop pill needs
  // none of this, since it holds its own open state and seeds in the handler that opens it
  //
  // Seed only on the rising edge, so an async data load or a re-render never wipes the edits the
  // user is making in the open surface. Adjusting state during render rather than in an effect is
  // what puts the seeded draft in the first painted frame
  const [wasOpen, setWasOpen] = useState(false)
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen)
    if (isOpen) seedDraft()
  }
}
