
import { CircleAlert, CircleCheck, OctagonAlert } from 'lucide-react'

export default function AttentionIcon({ label }: { label: string }) {
  if (label === 'On track') return <CircleCheck size={14} aria-hidden />
  if (label === 'Watch') return <CircleAlert size={14} aria-hidden />
  return <OctagonAlert size={14} aria-hidden />
}
