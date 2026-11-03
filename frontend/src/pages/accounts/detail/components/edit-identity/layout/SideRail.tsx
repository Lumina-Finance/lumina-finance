import { Pencil } from 'lucide-react'
import { ModalRail } from '@/components/modal/Rail'

/**
 * Renders the rail that identifies the modal as an edit workflow, the way every other modal draws its own
 */
export function EditModalSideRail() {
  return <ModalRail level="stacked" Icon={Pencil} label="Edit" insetClassName="pl-4" />
}
