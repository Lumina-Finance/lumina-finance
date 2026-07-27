import { EmptyState, ImportCollapseToggle, ImportCreateList, ImportStep } from '@/pages/imports/components'

type ImportAutoCreateStepProps = {
  index: string
  title: string
  description: string
  expanded: boolean
  collapseLabel: string
  expandLabel: string
  emptyTitle: string
  emptyDescription: string
  sourceLabel: string
  rows: string[]
  onToggle: () => void
}

/**
 * Collapsible step listing source values, such as merchants or tags, that import will create or
 * match by name without a mapping step of their own
 */
export function ImportAutoCreateStep({
  index,
  title,
  description,
  expanded,
  collapseLabel,
  expandLabel,
  emptyTitle,
  emptyDescription,
  sourceLabel,
  rows,
  onToggle,
}: ImportAutoCreateStepProps) {
  return (
    <ImportStep
      index={index}
      title={title}
      description={description}
      action={(
        <ImportCollapseToggle
          expanded={expanded}
          label={expanded ? collapseLabel : expandLabel}
          onClick={onToggle}
        />
      )}
    >
      {expanded && (rows.length === 0 ? (
        <EmptyState
          title={emptyTitle}
          description={emptyDescription}
        />
      ) : (
        <ImportCreateList
          sourceLabel={sourceLabel}
          rows={rows}
        />
      ))}
    </ImportStep>
  )
}
