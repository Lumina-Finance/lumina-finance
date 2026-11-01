import { Check, Pencil, Trash2, X } from 'lucide-react'
import { PendingLabel } from '@/components/loading/PendingLabel'
import { motion } from 'motion/react'
import type { Tag } from '@/api/tags'
import MarqueeText from '@/components/display/MarqueeText'
import { HintButton } from '@/components/tooltips/HintButton'
import InlineTagEdit from '@/pages/settings/components/tag-settings-section/editors/InlineEdit'
import {
  TAG_ROW_ANIMATE,
  TAG_ROW_EXIT,
  TAG_ROW_INITIAL,
  TAG_ROW_TRANSITION,
} from '@/pages/settings/components/tag-settings-section/constants'
import { scopeLabel } from '@/pages/settings/components/tag-settings-section/utils'

/**
 * One tag in the settings table, showing its name and scope alongside the edit and delete
 * controls
 *
 * Deleting asks for a second click on the row itself, confirming or cancelling in place, rather
 * than opening a separate modal
 */
export default function TagRow({
  confirmingDelete,
  deleting,
  isEditing,
  isLast,
  shouldReduceMotion,
  tag,
  onDeleteCancel,
  onDeleteConfirm,
  onDeleteRequest,
  onEdit,
  onEditCancel,
}: {
  confirmingDelete: boolean
  deleting: boolean
  isEditing: boolean
  isLast: boolean
  shouldReduceMotion: boolean | null
  tag: Tag
  onDeleteCancel: () => void
  onDeleteConfirm: (tag: Tag) => void | Promise<void>
  onDeleteRequest: (tag: Tag) => void
  onEdit: (tag: Tag) => void
  onEditCancel: () => void
}) {
  if (isEditing) {
    return <InlineTagEdit tag={tag} isLast={isLast} onCancel={onEditCancel} />
  }

  return (
    <motion.tr
      layout={!shouldReduceMotion}
      initial={shouldReduceMotion ? false : TAG_ROW_INITIAL}
      animate={shouldReduceMotion ? undefined : TAG_ROW_ANIMATE}
      exit={shouldReduceMotion ? { opacity: 0 } : TAG_ROW_EXIT}
      transition={shouldReduceMotion ? { duration: 0.12 } : TAG_ROW_TRANSITION}
      className="app-marquee-trigger"
      style={{ borderBottom: isLast ? 'none' : '1px solid var(--app-border)' }}
    >
      <td className="min-w-0 py-3 pl-4 pr-4 align-middle">
        <MarqueeText active className="font-medium">
          {tag.name}
        </MarqueeText>
        <p className="truncate text-xs" style={{ color: 'var(--app-text-muted)' }}>
          {scopeLabel(tag)}
        </p>
      </td>
      <td className="py-3 pr-4 align-middle">
        <div className="flex justify-end gap-1.5">
          {confirmingDelete ? (
            <>
              <HintButton
                className="app-icon-button"
                disabled={deleting}
                onClick={onDeleteCancel}
                aria-label={`Cancel deleting ${tag.name}`}
                hint="Cancel"
              >
                <X size={16} aria-hidden />
              </HintButton>
              <HintButton
                className="app-icon-button"
                disabled={deleting}
                onClick={() => onDeleteConfirm(tag)}
                aria-label={`Confirm delete ${tag.name}`}
                hint="Confirm delete"
              >
                <PendingLabel pending={deleting} name="Deleting">
                  <Check size={16} aria-hidden />
                </PendingLabel>
              </HintButton>
            </>
          ) : (
            <>
              <HintButton
                className="app-icon-button"
                onClick={() => onEdit(tag)}
                aria-label={`Edit ${tag.name}`}
                hint="Edit tag"
              >
                <Pencil size={16} aria-hidden />
              </HintButton>
              <HintButton
                className="app-icon-button"
                onClick={() => onDeleteRequest(tag)}
                aria-label={`Delete ${tag.name}`}
                hint="Delete tag"
              >
                <Trash2 size={16} aria-hidden />
              </HintButton>
            </>
          )}
        </div>
      </td>
    </motion.tr>
  )
}
