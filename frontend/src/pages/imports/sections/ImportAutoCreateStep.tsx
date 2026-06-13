import { EmptyState, ImportCollapseToggle, ImportCreateList, ImportStep } from '../components'

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
