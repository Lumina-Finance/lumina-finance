import { toTailwindZIndexTheme } from './src/constants/stackingLevels.ts'

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      // The "Variable" suffix is part of the family name the fontsource packages declare, rather
      // than a typo. DM Mono has no variable build, so its package keeps the bare name
      fontFamily: {
        sans: ['"DM Sans Variable"', 'system-ui', 'sans-serif'],
        serif: ['"Cormorant Garamond Variable"', 'Georgia', 'serif'],
        mono: ['"DM Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        display: ['"Cormorant Garamond Variable"', 'Georgia', 'serif'],
      },
      // The named levels an overlay that can reach the top of the page picks from, kept in
      // src/constants/stackingLevels.ts so the sites computing a style object read the same numbers
      // these classes carry. Extending rather than replacing, so Tailwind's own z-0 through z-50
      // survive for a level ordering siblings inside one container. That does leave three numbers
      // reachable two ways, z-30 and z-page-overlay among them, which is why the page content is
      // isolated: an in-page number cannot compete with a named level whatever it is set to
      zIndex: toTailwindZIndexTheme(),
      colors: {
        gold: '#C9A96A',
        'gold-bright': '#E4C17A',
        cream: '#ECE6DA',
        ink: '#0F0E0C',
        parchment: '#F2EDE4',
        green: '#6CA07B',
        red: '#B8584E',
      }
    }
  },
  future: {
    hoverOnlyWhenSupported: true
  }
}

