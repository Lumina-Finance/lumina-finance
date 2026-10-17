import type { OfxStagedFile } from '@/pages/imports/ofx/types'
import { IMPORT_SAVED_EARLIER_MESSAGE, labelStagedFiles } from '@/pages/imports/utils'

/**
 * Says an earlier import was saved in place of this one, and when the files staged now differ from
 * the files that earlier import held, names how, so the user knows which file was never imported and
 * which file Undo would take back, along with the rest of that import
 *
 * @param savedFiles - The files the saved import was sent with
 * @param stagedFiles - The files staged now
 */
export function describeOfxSavedEarlier(savedFiles: OfxStagedFile[], stagedFiles: OfxStagedFile[]) {
  const savedIds = new Set(savedFiles.map((file) => file.id))
  const stagedIds = new Set(stagedFiles.map((file) => file.id))
  const missing = listNames(stagedFiles.filter((file) => !savedIds.has(file.id)), stagedFiles)
  const removed = listNames(savedFiles.filter((file) => !stagedIds.has(file.id)), savedFiles)

  const sentences: string[] = [IMPORT_SAVED_EARLIER_MESSAGE]
  if (missing) {
    const isOne = missing.count === 1
    const verb = isOne ? 'isn\'t' : 'aren\'t'
    const remedy = isOne ? 'import that file on its own' : 'import those files on their own'
    sentences.push(`${missing.text} ${verb} in it, so ${remedy}.`)
  }
  if (removed) {
    sentences.push(`${removed.text} ${removed.count === 1 ? 'is' : 'are'} in it. Undo takes back the whole import, so import the files you want again afterwards.`)
  }
  return sentences.join(' ')
}

/**
 * Lists file names as a sentence part, naming a file by its position among its list, such as
 * "statement.qfx (file 2)", when another file in the list has the same name, as the skipped table does
 */
function listNames(files: OfxStagedFile[], list: OfxStagedFile[]) {
  if (files.length === 0) return null

  const labels = labelStagedFiles(list)
  const names = files.map((file) => labels[list.indexOf(file)])
  return { count: files.length, text: new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(names) }
}
