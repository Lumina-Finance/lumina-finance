/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
        serif: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        mono: ['"DM Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
      },
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

