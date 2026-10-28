/**
 * Guards every hover, focus and press look in the stylesheet easing over the app's one duration and
 * curve (`--app-ease-duration`, `--app-ease-curve`), so a button, row or card can't change at once or
 * ease over a duration of its own beside the controls around it. The focus ring's own fade
 * (`--app-focus-fade`) is a token of its own and not a literal, so it passes.
 */
import { readdirSync, readFileSync } from 'node:fs'
import type { AtRule, Container, Declaration, Document, Rule } from 'postcss'
import { describe, expect, it } from 'vitest'
import { stylesheet } from './fixtures'

/** Source files whose motion is the page's own layout moving, not a look, so it keeps a duration of its own */
const NOT_A_LOOK = new Set(['App.tsx', 'pages/imports/components/SetupPanel.tsx'])

/**
 * Lines whose transition is not a hover, focus or press look, such as a modal footer's width following its label,
 * a chart ring drawing in or a panel's margin following a sidebar, so they keep a duration of their own. They are
 * matched by line, never by file, so a hover look in the same file still has to take the shared duration
 */
const NOT_A_LOOK_LINE =
  /width 220ms|width 150ms ease-out|stroke-dashoffset 600ms|opacity 220ms cubic-bezier|\[margin-right\]|animationEasing=|import-stage-dot-hop|^\s*\/\/ /
const SOURCE_ROOT = new URL('../../src/', import.meta.url)

/** A time written out in a transition, such as 150ms or 0.2s, but not 0s, which turns easing off */
const LITERAL_DURATION = /(?<![\w.-])(?!0s\b)\d*\.?\d+m?s\b/
const STATE_PSEUDO = /:(hover|focus|focus-visible|focus-within|active)\b/
const APPLIED_DURATION = /\bduration-\S+/

/** What a state rule can set without changing a look that eases: the ring, the pointer and keyframes */
const UNANIMATED_PROP = /^(outline|cursor|z-index|pointer-events|transition|animation|--)/

/**
 * Modifier classes that sit on an element beside the class holding its transition, so a rule on the
 * modifier alone eases through the base. A state rule for a class in the second list gets its
 * transition from utility classes on its elements in the markup, each checked there
 */
const MODIFIER_OF: Record<string, string> = {
  '.app-nav-link-active': '.app-nav-link',
  '.app-segmented-option-active': '.app-segmented-option',
  '.app-input-error': '.app-input',
}
const TRANSITION_FROM_MARKUP = new Set([
  '.app-field-focus',
  '.app-field-focus-visible',
  '.app-card-row-focus-visible',
  '.app-accent-hover',
])

function insideReducedMotion(rule: Rule) {
  let parent: Container | Document | undefined = rule.parent
  while (parent) {
    if (parent.type === 'atrule' && /prefers-reduced-motion:\s*reduce/.test((parent as AtRule).params)) return true
    parent = parent.parent as Container | Document | undefined
  }
  return false
}

/** Splits at the characters outside brackets and parentheses where `separator` matches */
function splitOutside(text: string, separator: RegExp): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '(' || char === '[') depth += 1
    else if (char === ')' || char === ']') depth -= 1
    else if (depth === 0 && separator.test(char)) {
      parts.push(text.slice(start, index))
      start = index + 1
    }
  }
  parts.push(text.slice(start))
  return parts.map((part) => part.trim()).filter(Boolean)
}

/** The classes of the element a state rule styles: its last compound, without pseudo-classes or attributes */
function subjectOf(selector: string): string[] {
  const last = splitOutside(selector, /[\s>+~]/).at(-1) ?? selector
  const bare = last.replace(/:[\w-]+(\((?:[^()]|\([^()]*\))*\))?/g, '').replace(/\[[^\]]*\]/g, '')
  return (bare.match(/\.[\w-]+/g) ?? []).map((name) => MODIFIER_OF[name] ?? name)
}

function declaresMotion(rule: Rule) {
  let found = false
  rule.walkDecls('transition', (decl) => {
    if (decl.value.trim() !== 'none') found = true
  })
  rule.walkAtRules('apply', (apply) => {
    if (/(^|\s)transition/.test(apply.params)) found = true
  })
  return found
}

interface Look {
  selector: string
  subject: string[]
  props: string[]
}

const looks: Look[] = []
stylesheet.walkRules((rule) => {
  if (insideReducedMotion(rule)) return
  const props: string[] = []
  rule.walkDecls((decl: Declaration) => {
    if (!UNANIMATED_PROP.test(decl.prop)) props.push(decl.prop)
  })
  if (props.length === 0) return
  for (const selector of rule.selectors.map((entry) => entry.trim())) {
    if (STATE_PSEUDO.test(selector)) looks.push({ selector, subject: subjectOf(selector), props })
  }
})

function sameProperty(first: string, second: string) {
  return first === second || first.startsWith(`${second}-`) || second.startsWith(`${first}-`)
}

/** The lines of every source file that holds a look, as `file:line` and text */
function sourceLines(): { where: string; line: string }[] {
  const lines: { where: string; line: string }[] = []
  const visit = (directory: URL, prefix: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) visit(new URL(`${entry.name}/`, directory), `${prefix}${entry.name}/`)
      else if (/\.tsx?$/.test(entry.name) && !NOT_A_LOOK.has(`${prefix}${entry.name}`)) {
        readFileSync(new URL(entry.name, directory), 'utf8')
          .split('\n')
          .forEach((line, index) => {
            if (!NOT_A_LOOK_LINE.test(line)) lines.push({ where: `${prefix}${entry.name}:${index + 1}`, line })
          })
      }
    }
  }
  visit(SOURCE_ROOT, '')
  return lines
}

describe('transitions written in the components', () => {
  it('never name a literal duration or curve, in a class or an inline style', () => {
    // Tailwind duration, delay and ease utilities, even on a line with no `transition` word beside them
    const timingClass = /(?<![\w:-])(duration|delay|ease)-(\d|\[|\(|in\b|out\b|in-out\b|linear\b|initial\b)/
    const offenders = sourceLines()
      .filter(
        ({ line }) =>
          timingClass.test(line) ||
          (/\btransition/.test(line) && (/\b\d+(\.\d+)?m?s\b/.test(line) || /cubic-bezier\(/.test(line))),
      )
      .map(({ where }) => where)
    expect(offenders).toEqual([])
  })

  it('never run a transition class into the class beside it, which Tailwind then drops as one unknown class', () => {
    const glued = /\btransition-(colors|opacity|transform|shadow|all|none|\[[^\]]+\])(?=[a-z[])/
    // A class touching a template value that starts with a class, as in `nowrap${loading ? 'spin' : 'w-full'}`
    const touchingValue = /[a-z0-9\]]\$\{[^}]*\?\s*'[a-z]/
    const offenders = sourceLines()
      .filter(({ line }) => glued.test(line) || (/className=/.test(line) && touchingValue.test(line)))
      .map(({ where }) => where)
    expect(offenders).toEqual([])
  })
})

describe('hover, focus and press looks', () => {
  it('finds the looks it checks', () => {
    expect(looks.length).toBeGreaterThan(50)
  })

  it('ease, with a transition on the element they change', () => {
    const withMotion = new Set<string>()
    stylesheet.walkRules((rule) => {
      if (insideReducedMotion(rule) || !declaresMotion(rule)) return
      for (const selector of rule.selectors) subjectOf(selector).forEach((name) => withMotion.add(name))
    })
    const offenders = looks.filter(
      ({ subject }) => !subject.some((name) => withMotion.has(name) || TRANSITION_FROM_MARKUP.has(name)),
    )
    expect(offenders.map(({ selector }) => selector)).toEqual([])
  })

  it('take their duration from the shared token, never a literal', () => {
    const changed = new Map<string, Set<string>>()
    for (const { subject, props } of looks) {
      for (const name of subject)
        props.forEach((prop) => (changed.get(name) ?? changed.set(name, new Set()).get(name)!).add(prop))
    }
    const offenders: string[] = []
    stylesheet.walkRules((rule) => {
      if (insideReducedMotion(rule)) return
      for (const selector of rule.selectors) {
        const props = subjectOf(selector).flatMap((name) => [...(changed.get(name) ?? [])])
        if (props.length === 0) continue
        rule.walkDecls(/^transition(-duration)?$/, (decl) => {
          for (const entry of splitOutside(decl.value, /,/)) {
            const property = entry.split(/\s+/)[0]
            // A transition on a property no state rule changes, such as a menu collapsing, is not a look
            const isLook = property === 'all' || props.some((prop) => sameProperty(prop, property))
            if (isLook && LITERAL_DURATION.test(entry)) offenders.push(`${selector.trim()}: ${entry}`)
          }
        })
        rule.walkAtRules('apply', (apply) => {
          if (APPLIED_DURATION.test(apply.params)) offenders.push(`${selector.trim()}: @apply ${apply.params}`)
        })
      }
    })
    expect(offenders).toEqual([])
  })
})
