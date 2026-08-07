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
      // The one ordered list of stacking levels that can reach the top of the page, kept in
      // src/constants/stackingLevels.ts so the sites that compute a style object read the same
      // numbers these classes carry
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

