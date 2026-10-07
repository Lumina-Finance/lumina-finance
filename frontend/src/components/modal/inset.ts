import type { ModalLevel } from '@/components/modal/Shell'

// Left and right padding shared by a titled panel's header, body and footer, so labels, fields and
// actions start and end on the same edges at every width. The stacked level is the narrower panel, so
// it sits tighter to the edge once the dialog stops filling the screen
export const MODAL_INSET_CLASS_NAME: Record<ModalLevel, string> = {
  page: 'pl-4 pr-5 min-[1050px]:px-8',
  stacked: 'pl-4 pr-5 min-[1050px]:px-7',
}
