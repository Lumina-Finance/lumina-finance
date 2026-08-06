import { useState } from 'react'
import type { Institution } from '@/api/institutions'

/**
 * Holds the state the institution modal is opened with, from any field that offers one
 *
 * The modal reads its initial values once per mount and stays mounted while closed, so every
 * opening bumps `key` to remount it. Keeping that here is what stops a field from reopening
 * the modal onto whatever the last opening left in the form
 *
 * @param institutions - The list a correction resolves its target against. A field that only
 *   adds institutions leaves it out, and `openForCorrection` then finds nothing to open
 */
export function useInstitutionModal(institutions: Institution[] = []) {
  const [name, setName] = useState('')
  const [institution, setInstitution] = useState<Institution | null>(null)
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState(0)

  /**
   * Opens the modal to add an institution, carrying the dropdown's search text as its name
   */
  const openForCreate = (query: string) => {
    setName(query)
    setInstitution(null)
    setKey((current) => current + 1)
    setOpen(true)
  }

  /**
   * Opens the modal to correct an institution, ignoring an id the loaded list does not hold
   */
  const openForCorrection = (institutionId: string) => {
    const target = institutions.find((candidate) => candidate.id === institutionId)
    if (!target) return

    setName('')
    setInstitution(target)
    setKey((current) => current + 1)
    setOpen(true)
  }

  // Only the open flag, since the modal is still on screen while it animates out and would
  // otherwise switch from correcting to adding as it goes. What it was opened with is left
  // alone, because every opening sets both values before showing it again
  const close = () => {
    setOpen(false)
  }

  return { name, institution, open, key, openForCreate, openForCorrection, close }
}
