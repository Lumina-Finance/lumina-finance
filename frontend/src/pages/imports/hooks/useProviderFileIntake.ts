import { useState } from 'react'
import { LOADING_ANIMATION_MIN_MS, waitForMilliseconds } from '@/utils/timing'
import { type ImportFileAcquisition, type ImportFileType, processImportFileIntake } from '@/pages/imports/utils'

/**
 * Reads the files a provider import takes, with the kind of file being read and the reason each
 * kind of file was last refused
 *
 * Reading shows its busy state for at least the loading animation's minimum, so a small file
 * doesn't flash it
 *
 * @param kinds - Every kind of file the import takes, each holding its own refusal
 */
export function useProviderFileIntake<Kind extends string>(kinds: readonly Kind[]) {
  const [processingKind, setProcessingKind] = useState<Kind | null>(null)
  const [intakeErrors, setIntakeErrors] = useState<Record<Kind, string | null>>(() => getNoIntakeErrors(kinds))

  const setIntakeError = (kind: Kind, reason: string | null) => {
    setIntakeErrors((current) => ({ ...current, [kind]: reason }))
  }

  /**
   * Takes the files the user chose or dropped as one kind of file and reads all the accepted ones
   * together, recording a refusal against that kind
   *
   * @param unavailableReason - Why no file can be read yet, which refuses the files without reading them
   */
  const readImportFiles = async <Result>(kind: Kind, {
    files,
    unavailableReason,
    fileType,
    read,
  }: {
    files: ImportFileAcquisition
    unavailableReason: string | null
    fileType?: ImportFileType
    read: (files: File[]) => Promise<Result>
  }) => {
    const intake = await processImportFileIntake({
      files,
      processing: processingKind !== null,
      unavailableReason,
      fileType,
      readFiles: async (selectedFiles) => {
        setIntakeError(kind, null)
        setProcessingKind(kind)
        try {
          const [result] = await Promise.all([read(selectedFiles), waitForMilliseconds(LOADING_ANIMATION_MIN_MS)])
          return result
        } finally {
          setProcessingKind(null)
        }
      },
    })

    if (intake.status === 'refused') setIntakeError(kind, intake.reason)
    return intake
  }

  /**
   * Takes the file the user chose or dropped as one kind of file and reads it, for an upload whose
   * file type refuses more than one
   */
  const readImportFile = <Result>(kind: Kind, { read, ...options }: {
    files: ImportFileAcquisition
    unavailableReason: string | null
    fileType?: ImportFileType
    read: (file: File) => Promise<Result>
  }) => readImportFiles(kind, { ...options, read: ([file]) => read(file) })

  const resetFileIntake = () => {
    setProcessingKind(null)
    setIntakeErrors(getNoIntakeErrors(kinds))
  }

  return { processingKind, intakeErrors, setIntakeError, readImportFile, readImportFiles, resetFileIntake }
}

function getNoIntakeErrors<Kind extends string>(kinds: readonly Kind[]) {
  return Object.fromEntries(kinds.map((kind) => [kind, null])) as Record<Kind, string | null>
}
