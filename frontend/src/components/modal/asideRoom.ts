import { useMediaQuery } from '@/hooks/useMediaQuery'

// Where an aside has room beside the panel. The panel stays centred, so the aside needs its own width
// and gap free on both sides: 18rem and 1.5rem either side of the widest titled panel, 42rem, comes to
// 1296px, and the rest keeps it off the screen's edge. No breakpoint the app already has fits: the
// navigation's and the type's sit far below that, and the import page's 1280px leaves each side 8px
// short of the room the aside needs, so this one is the aside's own
const ASIDE_ROOM_QUERY = '(min-width: 1320px)'

/**
 * Whether the screen has room for an aside beside a centred modal panel, kept current as the window
 * resizes. A modal shows its aside there only while this holds, so what the aside carries has to go
 * somewhere inside the panel otherwise
 */
export function useAsideRoom(): boolean {
  return useMediaQuery(ASIDE_ROOM_QUERY)
}
