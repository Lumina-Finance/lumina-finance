/**
 * Restyles the chrome of the third-party emoji picker so it reads as the shared Dropdown's panel
 *
 * emoji-mart draws inside a shadow root, so no page stylesheet reaches it and its own options only
 * set a handful of colours. This sheet is adopted into that root instead. Custom properties cross
 * the boundary, so every colour is an `--app-*` token and both themes follow the app with no theme
 * branch here. Each block names the Dropdown rule it copies in tailwind.css.
 *
 * The emoji glyph font is deliberately left alone: `.category button` keeps the picker's own stack,
 * which is what the native emoji set renders with in the rows today.
 */
export const EMOJI_PICKER_STYLES = `
  /* The panel around the picker supplies the surface, as .app-dropdown-glass-floating does */
  #root {
    width: 100% !important;
    background-color: transparent;
    border-radius: 0;
    --duration: var(--app-ease-duration);
    --duration-fast: var(--app-ease-duration);
    --duration-instant: 0ms;
    --easing: var(--app-ease-curve);
  }

  /* The rows are 224px wide and fixed. The scrolling area reserves the scrollbar's room on both sides
     of them, so they sit in the middle whether or not a scrollbar is drawn, and the panel is sized
     to exactly that (--emoji-gutter, measured by the selector). The search row takes the same inset,
     so its rule and the headings' rules start and end together */
  .padding-lr {
    padding-left: 0;
    padding-right: 0;
  }

  #root > .padding-lr:not(.scroll) {
    margin: 0 var(--emoji-gutter, 0px);
  }

  .scroll {
    scrollbar-gutter: stable both-edges;
  }

  .scroll > div {
    margin: 0 auto;
  }

  /* Left at the whole height of the scrolling area, the results would never say how tall they are.
     Letting them take their own is what the panel measures to follow them. The full list states its
     height in pixels, so it is untouched */
  .scroll > div[style*="height: 100%"] {
    height: auto !important;
  }

  /* An empty result says so, in the Dropdown's own words and look, rather than leaving the heading
     over a blank */
  .category > div > .padding-small:empty::after {
    content: "No results";
    display: block;
    padding: var(--app-dropdown-row-padding-y) var(--app-dropdown-row-padding-x);
    color: var(--app-text-subtle);
    font-size: 0.875rem;
  }

  /* The app draws no custom scrollbar, so the picker's own is dropped for the native one, which
     takes the hairline token. A non-auto width is what makes the browser ignore the picker's rules */
  .scroll {
    scrollbar-width: thin;
    scrollbar-color: var(--app-border-strong) transparent;
  }

  /* .app-dropdown-search: a 36px row with the icon in the first column, no fill, no border of its
     own, a hairline under it, and no focus ring since focus lands in it as the panel opens */
  .spacer {
    display: none;
  }

  .search input[type="search"] {
    height: var(--app-dropdown-search-height);
    padding: 0 28px 0 36px;
    border-radius: 0;
    border-bottom: 1px solid var(--app-border);
    background-color: transparent;
    box-shadow: none;
    color: var(--app-text);
    font-size: 0.875rem;
  }

  .search input[type="search"]:focus {
    background-color: transparent;
    box-shadow: none;
  }

  .search input[type="search"]::placeholder {
    color: var(--app-text-subtle);
    opacity: 1;
  }

  .search .icon {
    color: var(--app-text-subtle);
    font-size: 1rem;
  }

  .search .loupe {
    left: var(--app-dropdown-row-padding-x);
  }

  .search .delete {
    right: var(--app-dropdown-row-padding-x);
    color: var(--app-text-muted);
    transition: color var(--app-ease-duration) var(--app-ease-curve);
  }

  .search .delete svg {
    width: 14px;
    height: 14px;
  }

  .search .delete:hover {
    color: var(--app-accent);
  }

  .search {
    margin-bottom: var(--app-dropdown-inner-padding);
  }

  /* .app-dropdown-group: the pinned heading, opaque over the grid it sits above, a hairline under
     it, small uppercase subtle text. The blur is dropped, since the panel is solid */
  .sticky {
    padding: 6px var(--app-dropdown-row-padding-x);
    background-color: var(--app-input-bg);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    border-bottom: 1px solid var(--app-border);
    color: var(--app-text-subtle);
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  /* .app-dropdown-row-highlighted: the cell under the pointer or the arrow keys takes a 6% wash of
     the text colour, eased in and out on the app's curve */
  .category button .background {
    background-color: color-mix(in srgb, var(--app-text) 6%, transparent);
    transition: opacity var(--app-ease-duration) var(--app-ease-curve);
  }

  .category button:hover .background {
    transition-duration: var(--app-ease-duration);
  }

  .category button[data-keyboard] .background {
    transition: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .category button .background,
    .search .delete {
      transition: none;
    }
  }
`

/**
 * Adds the restyle to a picker's shadow root, after its own sheet so it wins at equal weight
 */
export function applyEmojiPickerStyles(picker: HTMLElement) {
  const root = picker.shadowRoot
  if (!root) return
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(EMOJI_PICKER_STYLES)
  root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet]
}
