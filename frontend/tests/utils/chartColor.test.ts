/**
 * Verifies the chart colour map settles a tie the same way on every device, whatever collation the
 * browser would apply
 */
import { describe, expect, it } from 'vitest'
import { getDeterministicChartColorMap } from '@/utils/chartColor'

// The key only decides an entry's colour when two seeds hash to the same value, which is the one case
// the old locale-aware comparison could answer differently on a phone and a desktop. These two seeds
// were found by searching the hash for a collision
const COLLIDING_ENTRIES = [
  { key: 'category-a', seed: 'glbvs' },
  { key: 'category-b', seed: 'yacxa' },
]

/**
 * Runs something with string collation reversed, so anything consulting the browser's locale gives the
 * opposite answer to the one it gives normally
 */
function withReversedCollation<T>(run: () => T): T {
  const original = String.prototype.localeCompare

  String.prototype.localeCompare = function reversed(this: string, that: string) {
    return -original.call(this, that)
  }

  try {
    return run()
  } finally {
    String.prototype.localeCompare = original
  }
}

function buildColorMap(entries: { key: string, seed: string }[]) {
  return Object.fromEntries(getDeterministicChartColorMap(entries))
}

describe('getDeterministicChartColorMap', () => {
  it('gives entries with colliding seeds different colours', () => {
    const colors = buildColorMap(COLLIDING_ENTRIES)

    expect(colors['category-a']).not.toBe(colors['category-b'])
  })

  it('assigns the same colours when collation is reversed', () => {
    const colors = buildColorMap(COLLIDING_ENTRIES)

    expect(withReversedCollation(() => buildColorMap(COLLIDING_ENTRIES))).toEqual(colors)
  })

  it('assigns the same colours whatever order the entries arrive in', () => {
    const colors = buildColorMap(COLLIDING_ENTRIES)

    expect(buildColorMap([...COLLIDING_ENTRIES].reverse())).toEqual(colors)
  })
})
