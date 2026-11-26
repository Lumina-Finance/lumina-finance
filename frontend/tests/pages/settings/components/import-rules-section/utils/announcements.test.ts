/**
 * Covers what a screen reader hears while a rule or condition is dragged by keyboard
 *
 * These tests catch an announcement that names the wrong row, counts places from zero where a person
 * counts from one, says a row moved when it was dropped where it was, or talks over the pick-up. The
 * words around the name and the place are the builder's own, so each test reads the facts, not the sentence
 */
import type { Active, Over } from '@dnd-kit/core'
import { describe, expect, it } from 'vitest'
import { getSortAnnouncements } from '@/pages/settings/components/import-rules-section/utils/announcements'

const entries = [
  { id: 'a', label: 'Groceries' },
  { id: 'b', label: 'Fuel' },
  { id: 'c', label: 'Rent' },
]
const announcements = getSortAnnouncements(entries)
const active = (id: string) => ({ id }) as Active
const over = (id: string) => ({ id }) as Over

describe('sort announcements', () => {
  it('says what was picked up and where it is, counting from one', () => {
    const said = announcements.onDragStart?.({ active: active('b') })

    expect(said).toContain('Picked up Fuel')
    expect(said).toContain('number 2 of 3')
  })

  it('says where a row is over while it moves', () => {
    const said = announcements.onDragOver?.({ active: active('c'), over: over('a') })

    expect(said).toContain('Rent')
    expect(said).toContain('number 1 of 3')
  })

  it('says nothing while a row is over its own place, so the pick-up is not talked over', () => {
    expect(announcements.onDragOver?.({ active: active('c'), over: over('c') })).toBeUndefined()
    expect(announcements.onDragOver?.({ active: active('c'), over: null })).toBeUndefined()
  })

  it('says where a row was dropped, or that it stayed', () => {
    const moved = announcements.onDragEnd?.({ active: active('a'), over: over('c') })
    const stayed = announcements.onDragEnd?.({ active: active('a'), over: over('a') })
    const dropped = announcements.onDragEnd?.({ active: active('b'), over: null })

    expect(moved).toContain('Groceries')
    expect(moved).toContain('number 3 of 3')
    expect(stayed).toContain('stays at number 1 of 3')
    expect(dropped).toContain('stays at number 2 of 3')
  })

  it('says a cancelled move left the row where it was', () => {
    const said = announcements.onDragCancel?.({ active: active('c'), over: null })

    expect(said).toContain('Rent stays at number 3 of 3')
  })
})
