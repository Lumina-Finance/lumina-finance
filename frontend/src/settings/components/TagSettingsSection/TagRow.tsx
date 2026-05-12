import { Check, LoaderCircle, Pencil, Trash2, X } from 'lucide-react'
import { motion } from 'motion/react'
import type { Tag } from '@/api/tags'
import MarqueeText from '@/components/MarqueeText'
import InlineTagEdit from '@/settings/components/TagSettingsSection/InlineTagEdit'
import {
  TAG_ROW_ANIMATE,
  TAG_ROW_EXIT,
  TAG_ROW_INITIAL,
  TAG_ROW_TRANSITION,
} from '@/settings/components/TagSettingsSection/tagSettingsConstants'
import { scopeLabel } from '@/settings/components/TagSettingsSection/tagSettingsUtils'

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
    return (
      <InlineTagEdit
        tag={tag}
        isLast={isLast}
        onCancel={onEditCancel}
      />
    )
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
        <MarqueeText active className="font-medium">{tag.name}</MarqueeText>
        <p className="truncate text-xs" style={{ color: 'var(--app-text-muted)' }}>
          {scopeLabel(tag)}
        </p>
      </td>
      <td className="py-3 pr-4 align-middle">
        <div className="flex justify-end gap-1.5">
          {confirmingDelete ? (
            <>
              <button
                type="button"
                className="app-icon-button"
                disabled={deleting}
                onClick={onDeleteCancel}
                aria-label={`Cancel deleting ${tag.name}`}
                title="Cancel"
              >
                <X size={16} aria-hidden />
              </button>
              <button
                type="button"
                className="app-icon-button"
                disabled={deleting}
                onClick={() => onDeleteConfirm(tag)}
                aria-label={`Confirm delete ${tag.name}`}
                title="Confirm delete"
              >
                {deleting ? (
                  <span className="inline-flex items-center justify-center" aria-label="Deleting">
                    <LoaderCircle size={16} strokeWidth={2.4} className="animate-spin motion-reduce:animate-none" aria-hidden />
                  </span>
                ) : (
                  <Check size={16} aria-hidden />
                )}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="app-icon-button"
                onClick={() => onEdit(tag)}
                aria-label={`Edit ${tag.name}`}
                title="Edit tag"
              >
                <Pencil size={16} aria-hidden />
              </button>
              <button
                type="button"
                className="app-icon-button"
                onClick={() => onDeleteRequest(tag)}
                aria-label={`Delete ${tag.name}`}
                title="Delete tag"
              >
                <Trash2 size={16} aria-hidden />
              </button>
            </>
          )}
        </div>
      </td>
    </motion.tr>
  )
}
