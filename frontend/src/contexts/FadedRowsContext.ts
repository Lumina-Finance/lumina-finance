import { createContext, type CSSProperties } from 'react'

// True inside a section that already fades every transaction row in it, such as Upcoming
export const FadedRowsContext = createContext(false)

// Fades a transaction row by drawing its main text in the muted colour, which sets it apart from the
// rows that count while keeping every line readable. Lowering its opacity instead took the muted and
// subtle text below the contrast every text needs. The text colour is set as well as the token, since
// text that inherits its colour took it from the page before the token changed
export const FADED_ROW_COLOURS = { '--app-text': 'var(--app-text-muted)', color: 'var(--app-text)' } as CSSProperties
