import { ImportFileSlot, ImportFilesStepLayout, ImportNotice, ImportStagedFileTable } from '@/pages/imports/components'
import { OfxReveal } from '@/pages/imports/ofx/components/OfxReveal'
import { getOfxLeftOutNotice, OFX_IMPORT_FILE_TYPE } from '@/pages/imports/ofx/constants'
import type { OfxImportWorkflow, OfxStagedFile } from '@/pages/imports/ofx/hooks'

type OfxFilesStepProps = Pick<
  OfxImportWorkflow,
  | 'stagedFile'
  | 'ofxFile'
  | 'isProcessingFile'
  | 'fileIntakeError'
  | 'handleOfxFileChange'
  | 'removeOfxFile'
  | 'uploadBlockReason'
>

function describeOfxFile(file: OfxStagedFile) {
  const transactions = `${file.transactionCount} transaction${file.transactionCount === 1 ? '' : 's'}`
  const statements = `${file.statementCount} statement${file.statementCount === 1 ? '' : 's'}`
  return { detail: `${transactions} · ${statements}` }
}

/**
 * Files step of the OFX import flow, taking the one statement file, with transaction and
 * statement counts once it is read and a notice for the statements it leaves out
 */
export function OfxFilesStep({
  stagedFile,
  ofxFile,
  isProcessingFile,
  fileIntakeError,
  handleOfxFileChange,
  removeOfxFile,
  uploadBlockReason,
}: OfxFilesStepProps) {
  const leftOutNotice = ofxFile && getOfxLeftOutNotice(ofxFile.leftOut)

  return (
    <ImportFilesStepLayout
      title="Files"
      description="Upload a statement your bank exported as OFX or QFX."
      stats={[
        { label: 'Transactions', value: stagedFile?.transactionCount ?? 0 },
        { label: 'Statements', value: stagedFile?.statementCount ?? 0 },
      ]}
    >
      <ImportFileSlot
        label="Statement"
        required
        accept=".ofx,.qfx"
        uploadTitle="Upload statement"
        hint="An .ofx or .qfx file. One file can hold several statements."
        fileType={OFX_IMPORT_FILE_TYPE}
        staged={stagedFile && (
          <ImportStagedFileTable files={[stagedFile]} describe={describeOfxFile} onRemove={removeOfxFile} />
        )}
        processing={isProcessingFile}
        disabled={isProcessingFile || uploadBlockReason !== null}
        rejection={fileIntakeError}
        blockReason={uploadBlockReason}
        onFileChange={handleOfxFileChange}
      />

      <OfxReveal show={Boolean(leftOutNotice)}>
        <ImportNotice title="Statements left out">{leftOutNotice}</ImportNotice>
      </OfxReveal>
    </ImportFilesStepLayout>
  )
}
