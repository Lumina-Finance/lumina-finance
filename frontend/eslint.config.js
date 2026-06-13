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
  '@/api/insights',
  '@/api/institutions',
  '@/api/merchants',
  '@/api/tags',
  '@/api/taxAdvantagedCategories',
  '@/api/transactionImports',
  '@/api/transactions',
  '@/api/user',
  '@/api/version',
]

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
        },
      ],
    },
  },
])
