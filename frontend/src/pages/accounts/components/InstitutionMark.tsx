import type { Institution } from '@/api/institutions'
import { useUsableLogo } from '@/hooks/useUsableLogo'
import { resolveInstitutionLogoUrl } from '@/utils/institutionLogo'

// The tokens a bank without a usable logo takes its circle colour from, picked by its name so the
// same bank always gets the same colour
const FALLBACK_TOKENS = ['--app-accent', '--app-positive', '--app-negative', '--app-fx-blue'] as const

const SIZE_CLASS_NAME = {
  large: 'h-7 w-7 text-xs min-[750px]:h-9 min-[750px]:w-9 min-[750px]:text-sm',
  small: 'h-5 w-5 text-xs',
  stack: 'h-[21px] w-[21px] text-xs',
  xlarge: 'h-8 w-8 text-sm min-[750px]:h-[38px] min-[750px]:w-[38px] min-[750px]:text-base',
  row: 'h-5 w-5 text-xs',
} as const

function getFallbackToken(name: string): string {
  let hash = 0
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) % FALLBACK_TOKENS.length
  return FALLBACK_TOKENS[hash]
}

/**
 * Renders a bank as a round mark: its logo, or a coloured circle with its initial when it has none
 * or the logo fails to load. The small size carries a ring in the page colour so overlapping marks
 * stay apart
 */
export function InstitutionMark({
  institution,
  size,
}: {
  institution: Institution
  size: keyof typeof SIZE_CLASS_NAME
}) {
  const logo = useUsableLogo(resolveInstitutionLogoUrl(institution))
  const token = getFallbackToken(institution.name)

  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold leading-none ${SIZE_CLASS_NAME[size]}`}
      style={{
        background: logo.src ? 'var(--app-input-bg)' : `color-mix(in srgb, var(${token}) 22%, transparent)`,
        border: '1px solid var(--app-border)',
        color: 'var(--app-text)',
        boxShadow: size === 'small' || size === 'stack' ? '0 0 0 2px var(--app-bg)' : undefined,
      }}
    >
      {logo.src ? (
        <img
          src={logo.src}
          alt={`${institution.name} logo`}
          className="h-full w-full object-contain"
          loading="lazy"
          {...logo.imageProps}
        />
      ) : (
        <span className="select-none" aria-hidden>
          {institution.name.charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  )
}
