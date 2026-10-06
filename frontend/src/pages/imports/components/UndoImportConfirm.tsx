import { Undo2 } from 'lucide-react'
import type { LastImport } from '@/api/import-runs'
import { ModalDeleteConfirm } from '@/components/modal/DeleteConfirm'
import { describeUndoDeletion } from '@/pages/imports/utils/lastImport'

type UndoImportConfirmProps = {
  /** The import being undone, kept while the confirmation closes */
  entry: LastImport | null
  open: boolean
  error: string | null
  isUndoing: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Asks before an import is undone, saying everything that goes with it
 */
export function UndoImportConfirm({ entry, open, error, isUndoing, onConfirm, onCancel }: UndoImportConfirmProps) {
  return (
    <ModalDeleteConfirm
      open={open && entry !== null}
      label="Undo import"
      title="Undo this import?"
      RailIcon={Undo2}
      confirmLabel="Undo import"
      error={error}
      isDeleting={isUndoing}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      {entry && (
        <p className="text-sm leading-6" style={{ color: 'var(--app-text)' }}>{describeUndoDeletion(entry)}</p>
      )}
    </ModalDeleteConfirm>
  )
}
