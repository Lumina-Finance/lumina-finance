import { Link } from 'react-router'
import { CircleHelp } from 'lucide-react'
import IconTooltip from '@/components/tooltips/IconTooltip'

/**
 * Renders the explanation of how runway is calculated, with a link to the settings that set its thresholds
 *
 * The wording and the link live here so every page showing a runway figure explains it the same way
 */
export function RunwayHelpTooltip() {
  return (
    <IconTooltip
      label="How runway is calculated"
      icon={CircleHelp}
      placement="bottom"
      widthClassName="w-64"
    >
      <span className="block">
        Runway estimates how long selected asset accounts can cover net expenses, using completed months with recorded expenses.
      </span>
      <Link
        to="/settings#runway"
        className="mt-2 inline-flex font-semibold"
        style={{ color: 'var(--app-accent)' }}
      >
        Runway settings
      </Link>
    </IconTooltip>
  )
}
