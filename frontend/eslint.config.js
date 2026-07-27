import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// API internals must depend on concrete files so public index exports remain a feature boundary
const restrictedApiIndexImports = [
  '@/api/accounts',
  '@/api/auth',
  '@/api/budgets',
  '@/api/categories',
  '@/api/currency',
  '@/api/dashboard',
  '@/api/firefly-imports',
  '@/api/insights',
  '@/api/institutions',
  '@/api/merchants',
  '@/api/oidc',
  '@/api/passkeys',
  '@/api/tags',
  '@/api/tax-advantaged-categories',
  '@/api/transaction-imports',
  '@/api/transactions',
  '@/api/two-factor',
  '@/api/user',
  '@/api/version',
]

// The API layer talks to the backend and the query cache, never to the UI layers, so nothing
// under src/api may reach into pages, components, or contexts
const restrictedApiUiImports = ['@/pages/*', '@/components/*', '@/contexts/*']

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    files: ['src/api/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: restrictedApiIndexImports.map((name) => ({
            name,
            message: 'Import the specific API source file instead of the domain folder index',
          })),
          patterns: [
            {
              group: restrictedApiUiImports,
              message: 'The API layer must not import from the UI layers',
            },
          ],
        },
      ],
    },
  },
])
