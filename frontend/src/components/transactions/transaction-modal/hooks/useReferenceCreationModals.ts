import { useState } from 'react'

interface ReferenceCreationModalState {
  open: boolean
  name: string
  remountKey: number
  openModal: (name: string) => void
  closeModal: () => void
}

/**
 * Owns the open flag, prefilled name, and remount key for one inline reference-creation modal
 *
 * The remount key increments on every open so the created modal component, keyed on it, resets
 * its own internal form state between successive creations instead of reusing stale input
 */
function useReferenceCreationModal(): ReferenceCreationModalState {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [remountKey, setRemountKey] = useState(0)

  const openModal = (nextName: string) => {
    setName(nextName)
    setRemountKey((key) => key + 1)
    setOpen(true)
  }

  const closeModal = () => setOpen(false)

  return { open, name, remountKey, openModal, closeModal }
}

interface TransactionReferenceCreationModalsState {
  merchantModal: ReferenceCreationModalState
  categoryModal: ReferenceCreationModalState
  tagModal: ReferenceCreationModalState
}

/**
 * Owns the three inline reference-creation modals (merchant, category, tag) reachable from the
 * transaction form's dropdowns
 */
export function useTransactionReferenceCreationModals(): TransactionReferenceCreationModalsState {
  const merchantModal = useReferenceCreationModal()
  const categoryModal = useReferenceCreationModal()
  const tagModal = useReferenceCreationModal()
  return { merchantModal, categoryModal, tagModal }
}
