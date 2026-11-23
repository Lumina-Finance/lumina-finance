import type { ModalLevel } from '@/components/modal/Shell'

// Left and right padding shared by a titled panel's header, body and footer, so labels, fields and
// actions start and end on the same edges at every width. The stacked level is the narrower panel, so
// it sits tighter to the edge once the dialog stops filling the screen
export const MODAL_INSET_CLASS_NAME: Record<ModalLevel, string> = {
  page: 'pl-4 pr-5 min-[1050px]:px-8',
  stacked: 'pl-4 pr-5 min-[1050px]:px-7',
}

// A titled panel's body between its header and footer scrolls when the content is taller. Its padding is also
// its scroll padding, since focus scrolls a control into view only as far as the body's edge and would otherwise
// leave it flush against the header's or footer's rule instead of the room it has at the end of the scroll
export const MODAL_BODY_CLASS_NAME: Record<ModalLevel, string> = {
  page: `min-h-0 flex-1 overflow-y-auto pb-3 pt-4 scroll-pb-3 scroll-pt-4 ${MODAL_INSET_CLASS_NAME.page}`,
  stacked: `min-h-0 flex-1 overflow-y-auto pb-3 pt-4 scroll-pb-3 scroll-pt-4 ${MODAL_INSET_CLASS_NAME.stacked}`,
}
