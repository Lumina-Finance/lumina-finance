import { createContext } from 'react'

// True inside a section that already fades every transaction row in it, such as Upcoming. A read-only
// row there keeps the section's fade rather than also lowering its opacity, which would take the
// section's muted text below a readable contrast
export const FadedRowsContext = createContext(false)
