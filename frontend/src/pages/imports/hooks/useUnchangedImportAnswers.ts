import { useState } from 'react'
import { keepUnchangedImportAnswers } from '@/pages/imports/utils/importAnswers'

/**
 * Holds an import's answers as one object that changes only when one of its parts does, which is
 * what the import run compares to tell whether the user changed an answer
 */
export function useUnchangedImportAnswers<T extends object>(next: T): T {
  const [kept, setKept] = useState(next)
  const answers = keepUnchangedImportAnswers(kept, next)

  // Stored during render, as React advises for a value read from the previous render, so the next
  // render compares against the answers just returned
  if (answers !== kept) setKept(answers)
  return answers
}
