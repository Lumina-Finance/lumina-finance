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

// A path leaving its own folder is written through the alias so it reads the same wherever the
// importing file sits and survives the file being moved. Same-folder './' imports stay relative
const crossFolderRelativeImport = {
  group: ['../*', '../**'],
  message: 'Import through the @/ alias rather than a relative path that leaves the folder',
}

// Flat config replaces a rule outright rather than merging it, so a block that sets
// no-restricted-imports has to restate every pattern that should still apply to its files
const restrictedImportPatterns = [crossFolderRelativeImport]

const STACKING_LEVEL_MESSAGE =
  'Take the stacking level from STACKING_LEVELS in @/constants/stackingLevels, or name a module-level constant where the value only orders siblings inside one container'

// A stacking level written as a bare number is how the app ended up with five overlays at 110 and no
// statement anywhere of which belongs above which. Only the arbitrary bracket form is rejected, so
// z-10 through z-50 stay available for a level that orders siblings inside a single container.
//
// Each form needs two selectors. A class in a plain string is a Literal, while one built in a
// template literal lives in TemplateElement.value.raw, which App.tsx does. A numeric zIndex is
// matched on raw rather than value, because esquery applies a regex attribute test only to strings,
// and an assignment to element.style.zIndex is an AssignmentExpression rather than a Property
const restrictedStackingLevels = [
  {
    selector: 'Literal[value=/z-\\[\\d+\\]/]',
    message: STACKING_LEVEL_MESSAGE,
  },
  {
    selector: 'TemplateElement[value.raw=/z-\\[\\d+\\]/]',
    message: STACKING_LEVEL_MESSAGE,
  },
  {
    selector: "Property[key.name='zIndex'] > Literal[raw=/^-?\\d/]",
    message: STACKING_LEVEL_MESSAGE,
  },
  {
    selector: "AssignmentExpression[left.property.name='zIndex'] > Literal[raw=/^-?\\d/]",
    message: STACKING_LEVEL_MESSAGE,
  },
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
    rules: {
      'no-restricted-imports': ['error', { patterns: restrictedImportPatterns }],
      'no-restricted-syntax': ['error', ...restrictedStackingLevels],
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
            ...restrictedImportPatterns,
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
