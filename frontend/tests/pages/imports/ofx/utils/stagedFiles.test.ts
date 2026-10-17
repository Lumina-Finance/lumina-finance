/**
 * Tests that several OFX files make one import: each file is refused by name when it cannot join the
 * files staged, and the statements of all the files become one list in which an account that several
 * files hold is matched once
 */
import { describe, expect, it } from 'vitest'
import type { OfxFile, OfxStagedFile } from '@/pages/imports/ofx/types'
import { readOfxFile } from '@/pages/imports/ofx/utils/readFile'
import { combineOfxFiles, stageOfxFiles, type OfxStagingCandidate } from '@/pages/imports/ofx/utils/stagedFiles'
import { MAX_IMPORT_ROWS } from '@/pages/imports/utils'
import { buildLeftOutMessageSet, buildMessageSet, toOfxFile, wrapMessageSets, type FixtureStatement } from './fixtures'

async function readStatements(statements: FixtureStatement[], leftOut: string[] = []): Promise<OfxFile> {
  const read = await readOfxFile(toOfxFile(wrapMessageSets([...statements.map((statement) => buildMessageSet(statement, false)), ...leftOut])))
  if (read.status !== 'read') throw new Error(read.reason)
  return read.file
}

async function candidate(name: string, statements: FixtureStatement[], lastModified = 1): Promise<OfxStagingCandidate> {
  return { id: `id-${name}`, name, size: 100, lastModified, read: { status: 'read', file: await readStatements(statements) } }
}

const staged = (name: string, file: OfxFile): OfxStagedFile => ({ id: `id-${name}`, name, size: 100, lastModified: 1, file })

const JANUARY: FixtureStatement = { transactions: [{ name: 'Cafe', fitId: 'A1' }, { name: 'Rent', fitId: 'A2' }] }
const FEBRUARY: FixtureStatement = { transactions: [{ name: 'Market', fitId: 'B1' }] }

describe('staging statement files', () => {
  it('stages every readable file, in the order chosen', async () => {
    const { accepted, refusals } = stageOfxFiles([], [await candidate('2024-01.qfx', [JANUARY]), await candidate('2024-02.qfx', [FEBRUARY])])

    expect(accepted.map((file) => file.name)).toEqual(['2024-01.qfx', '2024-02.qfx'])
    expect(refusals).toEqual([])
  })

  it('refuses a file that is not a statement by name and keeps the rest', async () => {
    const notes: OfxStagingCandidate = {
      id: 'notes', name: 'notes.qfx', size: 5, lastModified: 1, read: { status: 'refused', reason: "This isn't an OFX or QFX statement." },
    }

    const { accepted, refusals } = stageOfxFiles([], [await candidate('2024-01.qfx', [JANUARY]), notes, await candidate('2024-02.qfx', [FEBRUARY])])

    expect(accepted.map((file) => file.name)).toEqual(['2024-01.qfx', '2024-02.qfx'])
    expect(refusals).toEqual(['"notes.qfx" was not added. This isn\'t an OFX or QFX statement.'])
  })

  it('leaves the files already staged alone when a file added later is refused', async () => {
    const held = [staged('2024-01.qfx', await readStatements([JANUARY]))]
    const notes: OfxStagingCandidate = { id: 'notes', name: 'notes.qfx', size: 5, lastModified: 1, read: { status: 'refused', reason: 'Not a statement.' } }

    const { accepted, refusals } = stageOfxFiles(held, [notes])

    expect(accepted).toEqual([])
    expect(refusals).toEqual(['"notes.qfx" was not added. Not a statement.'])
  })

  it('says only why, without the name, when the one file chosen onto nothing is refused', () => {
    const notes: OfxStagingCandidate = { id: 'notes', name: 'notes.qfx', size: 5, lastModified: 1, read: { status: 'refused', reason: 'Not a statement.' } }

    expect(stageOfxFiles([], [notes]).refusals).toEqual(['Not a statement.'])
  })

  it('refuses a file picked twice, which the browser reports as the same name, size and time', async () => {
    const held = [staged('2024-01.qfx', await readStatements([JANUARY]))]

    const { accepted, refusals } = stageOfxFiles(held, [await candidate('2024-01.qfx', [JANUARY]), await candidate('2024-02.qfx', [FEBRUARY])])

    expect(accepted.map((file) => file.name)).toEqual(['2024-02.qfx'])
    expect(refusals).toEqual(['"2024-01.qfx" was not added. It is already added.'])
  })

  it('refuses a file that would take the files past the most transactions an import holds', async () => {
    const january = await readStatements([JANUARY])
    const [statement] = january.statements
    const transactions = Array.from({ length: MAX_IMPORT_ROWS }, (_, index) => ({ ...statement.transactions[0], index: index + 1 }))
    const full = staged('full.qfx', { ...january, statements: [{ ...statement, transactions }] })

    const { accepted, refusals } = stageOfxFiles([full], [await candidate('2024-02.qfx', [FEBRUARY])])

    expect(accepted).toEqual([])
    expect(refusals).toEqual([`"2024-02.qfx" was not added. Together the files would have ${(MAX_IMPORT_ROWS + 1).toLocaleString()} transactions, and the importer reads up to ${MAX_IMPORT_ROWS.toLocaleString()}.`])
  })
})

describe('combining the statements of several files', () => {
  it('matches an account that several files hold once, with its transactions in the order of the files', async () => {
    const january = await readStatements([JANUARY])
    const february = await readStatements([{ transactions: [{ name: 'Market', fitId: 'B1' }, { name: 'Gas', fitId: 'B2' }] }])

    const combined = combineOfxFiles([january, february])

    expect(combined.statements).toHaveLength(1)
    expect(combined.statements[0].id).toBe(january.statements[0].id)
    expect(combined.statements[0].transactions.map((transaction) => transaction.payee)).toEqual(['Cafe', 'Rent', 'Market', 'Gas'])
  })

  it('numbers the transactions of a combined statement afresh, so each keeps an identity of its own', async () => {
    const combined = combineOfxFiles([await readStatements([JANUARY]), await readStatements([FEBRUARY])])

    expect(combined.statements[0].transactions.map((transaction) => transaction.index)).toEqual([1, 2, 3])
  })

  it('keeps statements for different accounts apart', async () => {
    const combined = combineOfxFiles([
      await readStatements([JANUARY]),
      await readStatements([{ ...FEBRUARY, accountId: '000999888777' }, { kind: 'creditCard', transactions: [{ name: 'Hardware' }] }]),
    ])

    expect(combined.statements.map((statement) => statement.label)).toEqual([
      'Checking ending 6789 (CAD)',
      'Checking ending 8777 (CAD)',
      'Credit card ending 1111 (CAD)',
    ])
  })

  it('keeps one account id in two currencies apart, since one account holds only one', async () => {
    const combined = combineOfxFiles([
      await readStatements([JANUARY]),
      await readStatements([{ ...FEBRUARY, currency: 'USD' }]),
    ])

    expect(combined.statements.map((statement) => [statement.currency, statement.transactions.length])).toEqual([['CAD', 2], ['USD', 1]])
    expect(new Set(combined.statements.map((statement) => statement.id)).size).toBe(2)
    expect(new Set(combined.statements.map((statement) => statement.name)).size).toBe(2)
  })

  // Many banks name every download alike, so a name two files share is told apart by the file's position
  it('names a file by its position only when another file has the same name, and orders the files', async () => {
    const readNamed = async (name: string, statement: FixtureStatement) => {
      const read = await readOfxFile(toOfxFile(wrapMessageSets([buildMessageSet(statement, false)]), name))
      if (read.status !== 'read') throw new Error(read.reason)
      return read.file
    }

    const combined = combineOfxFiles([
      await readNamed('statement.qfx', JANUARY),
      await readNamed('other.qfx', FEBRUARY),
      await readNamed('statement.qfx', { transactions: [{ name: 'Gas', fitId: 'C1' }] }),
    ])

    expect(combined.statements[0].transactions.map((transaction) => [transaction.fileName, transaction.fileOrder])).toEqual([
      ['statement.qfx (file 1)', 1],
      ['statement.qfx (file 1)', 1],
      ['other.qfx', 2],
      ['statement.qfx (file 3)', 3],
    ])
  })

  it('adds up the statements every file leaves out', async () => {
    const january = await readOfxFile(toOfxFile(wrapMessageSets([buildMessageSet(JANUARY, false), buildLeftOutMessageSet('LOANMSGSRSV1', 1)])))
    const february = await readOfxFile(toOfxFile(wrapMessageSets([buildMessageSet(FEBRUARY, false), buildLeftOutMessageSet('INVSTMTMSGSRSV1', 2), buildLeftOutMessageSet('LOANMSGSRSV1', 1)])))
    if (january.status !== 'read' || february.status !== 'read') throw new Error('Fixture files were not read')

    expect(combineOfxFiles([january.file, february.file]).leftOut).toEqual({ investment: 2, loan: 2 })
  })

  it('leaves a single file as it was read', async () => {
    const file = await readStatements([JANUARY, FEBRUARY])

    expect(combineOfxFiles([file])).toEqual(file)
  })
})
