import {
  getOfxLeftOutNotice,
  getOfxMultipleStatementsReason,
  OFX_IMPORT_FILE_TYPE,
  OFX_UPLOAD_LABEL,
} from '@/pages/imports/ofx/constants'
import type { OfxFormat } from '@/pages/imports/ofx/types'
import { readOfxFile } from '@/pages/imports/ofx/utils/readFile'

/** The OFX and QFX statements the statement import reads, which state their dates and amounts exactly */
export const OFX_FORMAT: OfxFormat = {
  source: 'ofx',
  fileType: OFX_IMPORT_FILE_TYPE,
  uploadLabel: OFX_UPLOAD_LABEL,
  read: readOfxFile,
  getLeftOutNotice: getOfxLeftOutNotice,
  getMultipleStatementsReason: getOfxMultipleStatementsReason,
  files: {
    accept: '.ofx,.qfx',
    description: 'Upload statements your bank exported as OFX or QFX, one file or several.',
    uploadTitle: 'Upload statements',
    addTitle: 'Add more statements',
    hint: 'Each file is an .ofx or .qfx statement. One file can hold several statements.',
    getFixedAccountHint: (accountName) =>
      `Each file is an .ofx or .qfx statement for ${accountName}, holding one statement.`,
    statementNoun: 'statement',
  },
  reading: null,
}
