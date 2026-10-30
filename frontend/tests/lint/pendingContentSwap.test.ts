/**
 * Guards every control that swaps its content for a spinner while a request is in flight being drawn with
 * the shared PendingLabel, which crossfades the two, eases the control's width and names the spinner. A
 * spinner swapped in by hand again would snap, and one with no name would leave the control without one
 *
 * Sweeps all of frontend source rather than a list of controls, so a new one is caught as well
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PendingLabel } from '@/components/loading/PendingLabel'

const sourceRoot = fileURLToPath(new URL('../../src', import.meta.url))

// Spinners that stand in for content still loading, on a page or a panel, with no control and no label to
// fade from. Each is a status that names what is loading
const LOADING_PLACEHOLDERS = new Set([
  'components/category-icon-selector/Selector.tsx',
  'components/loading/PendingLabel.tsx',
  'components/loading/Transition.tsx',
  'components/two-factor/TotpEnrollment.tsx',
  'pages/accounts/components/ListSection.tsx',
  'pages/budgets/components/budget-details-modal/HistoryChart.tsx',
  'pages/imports/ImportsPage.tsx',
  'pages/transactions/components/top-band/MostExpensiveTransactionsPanel.tsx',
])

// Buttons that hold a spinner with no label swapping for it, or that already fade their label into one, ease
// their width, drop the motion under reduced motion and keep their own accessible name. TopBand's retry is
// the second kind, and the import dropzone is the first, a panel of status text with a spinner among it
const HAND_DRAWN_SWAPS = new Set([
  'pages/transactions/components/TopBand.tsx',
  'pages/imports/components/FileUpload.tsx',
])

function listSourceFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = `${folder}/${entry.name}`
    if (entry.isDirectory()) return listSourceFiles(path)
    return /\.tsx$/.test(entry.name) ? [path] : []
  })
}

const files = listSourceFiles(sourceRoot).map((path) => ({
  name: path.slice(sourceRoot.length + 1),
  text: readFileSync(path, 'utf8'),
}))

describe('pending content swap', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is the shared PendingLabel wherever a control swaps its content for a spinner', () => {
    const bySpinner = files.filter((file) => file.text.includes('app-spinner') && !LOADING_PLACEHOLDERS.has(file.name))
    expect(bySpinner.map((file) => file.name)).toEqual([])
  })

  it('is on every control drawn as the pending circle', () => {
    const circles = files.filter((file) => file.text.includes('app-primary-button-loading'))
    expect(circles.length).toBeGreaterThan(20)
    const without = circles.filter((file) => !file.text.includes('<PendingLabel'))
    expect(without.map((file) => file.name)).toEqual([])
  })

  it('has no spinner drawn by hand inside a button, whichever way the spinner is drawn', () => {
    const buttons = files.flatMap((file) =>
      [...file.text.matchAll(/<(motion\.)?button\b[\s\S]*?<\/(motion\.)?button>/g)].map((match) => ({
        name: file.name,
        text: match[0],
      })),
    )
    const byHand = buttons.filter(
      (button) => /animate-spin|LoaderCircle|Loader2/.test(button.text) && !HAND_DRAWN_SWAPS.has(button.name),
    )
    expect(byHand.map((button) => button.name)).toEqual([])
    // Every button drawn as the pending circle or holding the spinner carries the shared swap itself, not
    // only some other button in its file
    const unshared = buttons.filter(
      (button) =>
        /app-primary-button-loading|app-spinner/.test(button.text) &&
        !/<(PendingLabel|Crossfade)\b/.test(button.text) &&
        !LOADING_PLACEHOLDERS.has(button.name),
    )
    expect(unshared.map((button) => button.name)).toEqual([])
  })

  it('draws the idle content alone, then a spinner named for the action once pending', () => {
    // Reduced motion draws the content without the animated layers, which need a browser to mount
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
    const idle = renderToStaticMarkup(createElement(PendingLabel, { pending: false, name: 'Save', children: 'Save' }))
    const pending = renderToStaticMarkup(createElement(PendingLabel, { pending: true, name: 'Save', children: 'Save' }))
    expect(idle).toContain('Save')
    expect(idle).not.toContain('app-spinner')
    expect(pending).toContain('class="app-spinner" role="img" aria-label="Save"')
    expect(pending).not.toContain('>Save<')
    // The marker the stylesheet reads to give the control its eased width
    expect(idle).toContain('data-eased-width')
    expect(pending).toContain('data-eased-width')
  })
})
