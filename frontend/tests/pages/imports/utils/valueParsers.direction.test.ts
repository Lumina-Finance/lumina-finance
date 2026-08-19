/**
 * Tests reading a word from a file's direction column as the direction it states, and when those
 * words settle a whole column on their own
 */
import { describe, expect, it } from 'vitest'
import {
  foldImportDirectionValue,
  guessImportDirectionAnswers,
  readImportDirectionWord,
} from '@/pages/imports/utils'

describe('reading one direction word', () => {
  it('reads the bookkeeping abbreviations both ways', () => {
    expect(readImportDirectionWord('DR')).toBe('out')
    expect(readImportDirectionWord('Cr.')).toBe('in')
  })

  // Capitals and punctuation are dropped before the word is looked up, so a file writing Debit and
  // one writing DEBIT get the same answer
  it('reads a word however it is capitalised or punctuated', () => {
    expect(readImportDirectionWord('debit')).toBe('out')
    expect(readImportDirectionWord(' Withdrawal ')).toBe('out')
    expect(readImportDirectionWord('money-in')).toBe('in')
  })

  // A file stating direction as a bare sign is read before punctuation is stripped, since stripping
  // would leave nothing to match
  it('reads a bare sign as a direction', () => {
    expect(readImportDirectionWord('-')).toBe('out')
    expect(readImportDirectionWord('+')).toBe('in')
  })

  it('reads nothing from a word it does not know', () => {
    expect(readImportDirectionWord('Sortie')).toBeNull()
    expect(readImportDirectionWord('')).toBeNull()
  })

  // Read off the table's own keys rather than the property, or a column of words spelling
  // constructor would come back with the function every object inherits
  it('reads nothing from a word naming something every object has', () => {
    expect(readImportDirectionWord('constructor')).toBeNull()
    expect(readImportDirectionWord('toString')).toBeNull()
  })
})

describe('answering a whole direction column from its words', () => {
  it('fills in a pair it recognises as opposite directions', () => {
    expect(guessImportDirectionAnswers(['DEBIT', 'CREDIT'])).toEqual({ debit: 'out', credit: 'in' })
    expect(guessImportDirectionAnswers(['Purchase', 'Refund'])).toEqual({ purchase: 'out', refund: 'in' })
  })

  // The words a file uses are its own, and no list finishes, so an unrecognised pair is left for the
  // user rather than guessed at
  it('answers nothing where it recognises neither word', () => {
    expect(guessImportDirectionAnswers(['Sortie', 'Entrée'])).toEqual({})
  })

  // Half an answer is worse than none: the unrecognised word would sit unanswered while the other
  // read as settled, and the user would have no reason to look at it
  it('answers nothing where it recognises only one of the two', () => {
    expect(guessImportDirectionAnswers(['DEBIT', 'Sortie'])).toEqual({})
  })

  // Two words both reading as money out cannot be the two answers of a column stating direction, so
  // the reading is wrong about at least one of them
  it('answers nothing where both words read the same way', () => {
    expect(guessImportDirectionAnswers(['Debit', 'Payment'])).toEqual({})
    expect(guessImportDirectionAnswers(['Credit', 'Deposit'])).toEqual({})
  })

  // A card statement of nothing but purchases states its direction perfectly well with one word
  it('answers a column holding one word it recognises', () => {
    expect(guessImportDirectionAnswers(['DEBIT'])).toEqual({ debit: 'out' })
  })

  it('keys its answers by the folded value', () => {
    expect(guessImportDirectionAnswers([' DEBIT ', 'Credit'])).toEqual({ debit: 'out', credit: 'in' })
  })
})

describe('folding a value into the key its answer is filed under', () => {
  it('folds away capitals and surrounding spaces', () => {
    expect(foldImportDirectionValue(' DEBIT ')).toBe('debit')
    expect(foldImportDirectionValue('Money Out')).toBe('money out')
  })

  // Every value made only of characters a stricter fold drops would come back empty, and one empty
  // key holds one answer. A file stating its direction as bare signs would then have every row read
  // as whichever sign the file used first, so half of them would commit backwards with nothing on
  // screen saying so
  it('keeps two values apart when neither has a letter or a digit', () => {
    expect(foldImportDirectionValue('-')).not.toBe(foldImportDirectionValue('+'))
  })

  // The same collapse in any script other than the Latin alphabet, which is most of them
  it('keeps two values apart when neither is written in Latin letters', () => {
    expect(foldImportDirectionValue('Дебет')).not.toBe(foldImportDirectionValue('Кредит'))
    expect(foldImportDirectionValue('出金')).not.toBe(foldImportDirectionValue('入金'))
  })

  // The word list is matched after a stricter fold, so a wording carrying punctuation is
  // still recognised even though its answer is filed under the spelling the file used
  it('still reads a punctuated wording as the direction it states', () => {
    expect(guessImportDirectionAnswers(['Dr.', 'Cr.'])).toEqual({ 'dr.': 'out', 'cr.': 'in' })
    expect(guessImportDirectionAnswers(['money-out', 'money-in'])).toEqual({ 'money-out': 'out', 'money-in': 'in' })
  })
})
