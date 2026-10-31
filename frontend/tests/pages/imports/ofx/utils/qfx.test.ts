/**
 * Tests that a QFX file from Quicken, its own flavour of OFX, goes to the OFX import as it is: the
 * file is offered there and not to the QIF import, and the Intuit sign-on fields it adds read as the
 * same statement as the OFX without them
 */
import { describe, expect, it } from 'vitest'
import { OFX_FORMAT } from '@/pages/imports/ofx/format'
import { readOfxFile } from '@/pages/imports/ofx/utils/readFile'
import { QIF_FORMAT } from '@/pages/imports/qif/format'
import { buildSgmlOfx, toOfxFile, type FixtureStatement } from './fixtures'

const CHECKING: FixtureStatement = {
  transactions: [{ fitId: 'A1', amount: '-12.50', posted: '20240115', name: 'Corner Cafe' }],
} as FixtureStatement

// The sign-on block Quicken adds to the OFX it writes: the financial institution and Intuit's own IDs
const QUICKEN_SIGN_ON_FIELDS =
  '<DTSERVER>20240201\n<FI>\n<ORG>Example Bank\n<FID>3000\n</FI>\n<INTU.BID>3000\n<INTU.USERID>jdoe\n'

describe('a QFX file from Quicken', () => {
  it('is offered by the OFX import and not the QIF one', () => {
    const qfx = toOfxFile('', 'export.qfx')

    expect(OFX_FORMAT.fileType.matches(qfx)).toBe(true)
    expect(OFX_FORMAT.files.accept).toContain('.qfx')
    expect(QIF_FORMAT.fileType.matches(qfx)).toBe(false)
  })

  it('reads with the Intuit sign-on fields as the same statement as the OFX without them', async () => {
    const plain = buildSgmlOfx([CHECKING])
    const quicken = plain.replace('<DTSERVER>20240201\n', QUICKEN_SIGN_ON_FIELDS)
    expect(quicken).toContain('<INTU.BID>3000')

    const [fromQfx, fromOfx] = await Promise.all([
      readOfxFile(toOfxFile(quicken, 'export.qfx'), 'f'),
      readOfxFile(toOfxFile(plain, 'export.ofx'), 'f'),
    ])
    if (fromQfx.status !== 'read' || fromOfx.status !== 'read') throw new Error('Not read')

    const [transaction] = fromQfx.file.statements[0].transactions
    expect(transaction).toMatchObject({ amount: '-12.50', bankTransactionId: 'A1' })
    expect({ ...transaction, fileName: 'export.ofx' }).toEqual(fromOfx.file.statements[0].transactions[0])
  })
})
