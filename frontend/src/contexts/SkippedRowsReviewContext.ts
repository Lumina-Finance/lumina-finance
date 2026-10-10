import { createContext } from 'react'

// How many times the user has asked, from a finished import, to review the rows it left out. A skipped
// rows list that answers it opens and brings itself into view each time the count goes up
export const SkippedRowsReviewContext = createContext(0)
