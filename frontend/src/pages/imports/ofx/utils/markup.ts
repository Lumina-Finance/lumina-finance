/**
 * One element of an OFX file: an aggregate holding other elements, or a leaf holding a value
 *
 * OFX 2.x is XML. OFX 1.x is SGML, where a leaf such as `<TRNAMT>-12.50` has no closing tag, which
 * no XML parser reads. One reader for both tells a leaf by the value following its tag
 */
export interface OfxNode {
  name: string

  /** The element's text with entities decoded, or null for an aggregate */
  value: string | null
  children: OfxNode[]
}

type Token =
  | { type: 'open' | 'close'; name: string }
  | { type: 'text'; value: string }

// A tag, a declaration, processing instruction or comment to skip, or the text up to the next one.
// A lone angle bracket that starts none of them is skipped so it cannot stall the scan
const TOKEN_PATTERN = /<(\/?)([A-Za-z][\w.-]*)\s*>|<[?!][^>]*>|([^<]+)|</g

const ENTITY_PATTERN = /&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi
const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** Decodes the entities in one pass, so a decoded ampersand is never decoded a second time */
function decodeEntities(text: string) {
  return text.replace(ENTITY_PATTERN, (match, decimal?: string, hex?: string, named?: string) => {
    if (named) return NAMED_ENTITIES[named.toLowerCase()]
    const codePoint = decimal ? Number(decimal) : parseInt(hex ?? '', 16)
    return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match
  })
}

// Real statements nest about eight deep. A file nesting far past that is not one, and reading it
// would only build a tree for the sake of walking it
const MAX_OFX_DEPTH = 64

// The aggregates of the OFX schema. An SGML tag with nothing after it is an empty leaf unless it is
// one of these, whose children follow it as tags
const AGGREGATE_PATTERN = new RegExp(
  '^(?:OFX|SONRS|STATUS|FI|MKTGINFO|STMTTRN|PAYEE|CURRENCY|ORIGCURRENCY|LEDGERBAL|AVAILBAL|BANKTRANLIST'
  + '|[A-Z]*ACCT(?:FROM|TO)|[A-Z]*STMTRS|[A-Z]*MSGSR[SQ]V\\d+|[A-Z]*TRN(?:RS|RQ)|INV[A-Z]*|LOAN[A-Z]*)$',
)

function tokenize(markup: string): Token[] {
  const tokens: Token[] = []
  for (const match of markup.matchAll(TOKEN_PATTERN)) {
    const [, slash, name, text] = match
    if (name) tokens.push({ type: slash ? 'close' : 'open', name: name.toUpperCase() })
    else if (text?.trim()) tokens.push({ type: 'text', value: text.trim() })
  }
  return tokens
}

/**
 * Reads the markup from its `<OFX>` tag on into a tree, or returns null when the file has no such tag
 *
 * Everything before the tag is the header, which holds no statement data. A closing tag closes the
 * nearest open element of its name, and one that matches nothing open is ignored
 */
export function parseOfxMarkup(text: string): OfxNode | null {
  const start = text.search(/<OFX\s*>/i)
  if (start === -1) return null

  const tokens = tokenize(text.slice(start))
  const root: OfxNode = { name: '', value: null, children: [] }
  const open: OfxNode[] = [root]

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    const parent = open[open.length - 1]

    if (token.type === 'open') {
      const next = tokens[index + 1]
      if (next?.type === 'text') {
        parent.children.push({ name: token.name, value: decodeEntities(next.value), children: [] })
        index += 1

        // XML closes the leaf it just gave, SGML does not
        const closing = tokens[index + 1]
        if (closing?.type === 'close' && closing.name === token.name) index += 1
      } else if (next?.type === 'close' && next.name === token.name) {
        parent.children.push({ name: token.name, value: '', children: [] })
        index += 1
      } else if (!AGGREGATE_PATTERN.test(token.name)) {
        // An empty SGML leaf such as <CHECKNUM> has no closing tag, so what follows is its sibling
        parent.children.push({ name: token.name, value: '', children: [] })
      } else {
        const aggregate: OfxNode = { name: token.name, value: null, children: [] }
        parent.children.push(aggregate)
        open.push(aggregate)
        if (open.length > MAX_OFX_DEPTH) return null
      }
    } else if (token.type === 'close') {
      const position = open.findLastIndex((node) => node.name === token.name)
      if (position > 0) open.length = position
    }
  }

  return root.children.find((node) => node.name === 'OFX') ?? null
}

/** The first element of a name directly under a node, or undefined */
export function findChild(node: OfxNode, name: string) {
  return node.children.find((child) => child.name === name)
}

/** The value of the first leaf of a name directly under a node, trimmed, or null when absent or blank */
export function readLeaf(node: OfxNode, name: string) {
  const value = findChild(node, name)?.value?.trim()
  return value || null
}

/** Every element of a name anywhere under a node, in file order */
export function findAllDescendants(node: OfxNode, name: string): OfxNode[] {
  const found: OfxNode[] = []
  const pending = [...node.children].reverse()
  for (let current = pending.pop(); current; current = pending.pop()) {
    if (current.name === name) found.push(current)
    for (let index = current.children.length - 1; index >= 0; index -= 1) pending.push(current.children[index])
  }
  return found
}
