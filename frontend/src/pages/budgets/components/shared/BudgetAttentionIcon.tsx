
import { CircleAlert, CircleCheck, OctagonAlert } from 'lucide-react'

/**
 * Maps budget attention labels to the icon used in cards and details summaries
 */
export default function BudgetAttentionIcon({ label }: { label: string }) {
  if (label === 'On track') return <CircleCheck size={14} aria-hidden />
  if (label === 'Watch') return <CircleAlert size={14} aria-hidden />
  return <OctagonAlert size={14} aria-hidden />
}
