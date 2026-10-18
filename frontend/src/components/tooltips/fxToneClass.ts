export type IconTooltipFxTone = 'blue' | 'red' | 'gray'

// The idle and open classes of each FX badge tone. Kept apart from the component so the stylesheet contrast
// test can read the colours these classes really draw. The red and gray fills behind a white label take
// their own tokens, since the dark theme's negative and muted colours are too light for it
export const FX_TONE_CLASS: Record<IconTooltipFxTone, { idle: string; active: string }> = {
  blue: {
    idle: 'border-[color-mix(in_srgb,var(--app-fx-blue)_48%,transparent)] bg-[color-mix(in_srgb,var(--app-fx-blue)_13%,var(--app-bg))] text-[var(--app-fx-blue-text)] group-hover:border-[var(--app-fx-blue)] group-hover:bg-[var(--app-fx-blue)] group-hover:text-white',
    active: 'border-[var(--app-fx-blue)] bg-[var(--app-fx-blue)] text-white',
  },
  red: {
    idle: 'border-[color-mix(in_srgb,var(--app-negative)_48%,transparent)] bg-[color-mix(in_srgb,var(--app-negative)_13%,var(--app-bg))] text-[var(--app-negative)] group-hover:border-[var(--app-danger-fill)] group-hover:bg-[var(--app-danger-fill)] group-hover:text-white',
    active: 'border-[var(--app-danger-fill)] bg-[var(--app-danger-fill)] text-white',
  },
  gray: {
    idle: 'border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-text-muted)_10%,var(--app-bg))] text-[var(--app-text-muted)] group-hover:border-[var(--app-fx-gray-fill)] group-hover:bg-[var(--app-fx-gray-fill)] group-hover:text-white',
    active: 'border-[var(--app-fx-gray-fill)] bg-[var(--app-fx-gray-fill)] text-white',
  },
}
