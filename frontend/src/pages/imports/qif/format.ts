import type { OfxFormat } from '@/pages/imports/ofx/types'
import {
  getQifLeftOutNotice,
  getQifMultipleStatementsReason,
  QIF_AMOUNT_FORMAT_REQUIRED_ERROR,
  QIF_DATE_FORMAT_REQUIRED_ERROR,
  QIF_IMPORT_FILE_TYPE,
  QIF_UPLOAD_LABEL,
} from '@/pages/imports/qif/constants'
import { readQifFile } from '@/pages/imports/qif/utils/readFile'
import { resolveQifFile, scanQifReadings } from '@/pages/imports/qif/utils/readings'

/**
 * The QIF files the statement import reads. A QIF file states no currency and no fixed shape for its
 * dates and amounts, so the user's account answers set the currency and a reading choice fixes the rest
 */
export const QIF_FORMAT: OfxFormat = {
  source: 'qif',
  fileType: QIF_IMPORT_FILE_TYPE,
  uploadLabel: QIF_UPLOAD_LABEL,
  read: readQifFile,
  getLeftOutNotice: getQifLeftOutNotice,
  getMultipleStatementsReason: getQifMultipleStatementsReason,
  files: {
    accept: '.qif',
    description: 'Upload QIF files exported from your finance app, one file or several.',
    uploadTitle: 'Upload QIF files',
    addTitle: 'Add more QIF files',
    hint: 'Each file is a .qif export. One file can hold several accounts.',
    getFixedAccountHint: (accountName) => `Each file is a .qif export for ${accountName}, holding one account.`,
    statementNoun: 'account',
  },
  reading: {
    scan: scanQifReadings,
    resolve: resolveQifFile,
    dateRequiredError: QIF_DATE_FORMAT_REQUIRED_ERROR,
    amountRequiredError: QIF_AMOUNT_FORMAT_REQUIRED_ERROR,
  },
}
