import { useState } from 'react'
import { useInstitutionModal } from '@/hooks/useInstitutionModal'

/**
 * Opens the new-institution modal from an account step's fields and hands the institution it
 * creates back to the field that asked for it
 *
 * @param onSaved - Gives the created institution to the field named by `target`, which is a row's
 *   source or a name the step gives its batch bar
 * @returns How to open the modal, and the key and props the step's `InstitutionModal` takes. The key
 *   is kept apart, since React warns about a key spread in with the props
 */
export function useImportInstitutionModal(onSaved: (target: string, institutionId: string) => void) {
  const institutionModal = useInstitutionModal()

  // Which field asked for a new institution, so the one it creates comes back to that field
  const [target, setTarget] = useState<string | null>(null)

  const openInstitutionModal = (query: string, nextTarget: string) => {
    setTarget(nextTarget)
    institutionModal.openForCreate(query)
  }

  const close = () => {
    setTarget(null)
    institutionModal.close()
  }

  return {
    openInstitutionModal,
    institutionModalKey: institutionModal.key,
    institutionModalProps: {
      open: institutionModal.open,
      initialName: institutionModal.name,
      institution: institutionModal.institution,
      onClose: close,
      onSaved: (institution: { id: string }) => {
        // A correction changes an institution rather than which one a field answers with, so it
        // comes back to no field and leaves every answer as it was
        if (target !== null) onSaved(target, institution.id)
        close()
      },
    },
  }
}
