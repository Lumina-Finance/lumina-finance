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
  'Name the stacking level: a class from the scale such as z-popover, or STACKING_LEVELS from @/constants/stackingLevels where a style object or a DOM write needs the number. Where the value only orders siblings inside one container, name a module-level constant beside it instead'

// Interpolating a level into an arbitrary class is worse than the bare number it replaces. Tailwind
// only generates a class it finds as complete literal text, so the element ends up with no stacking
// level at all rather than the wrong one, and nothing reports it
const INTERPOLATED_CLASS_MESSAGE =
  'Tailwind never generates a class assembled by interpolation, so this element would carry no stacking level at all. Use a class from the scale, such as z-popover'

const SET_PROPERTY_MESSAGE =
  'Set a stacking level through element.style.zIndex rather than through setProperty, so it reads as a level and the scale covers it'

// A stacking level written as a bare number is how the app ended up with five overlays at 110 and no
// statement anywhere of which belongs above which. Only the arbitrary bracket form of the class is
// rejected, so a bare z-10 or z-30 stays available for a level ordering siblings inside one container.
//
// One form needs several selectors, because the same value reaches the tree differently depending on
// how it was written. A class in a plain string is a Literal, while one built in a template literal
// lives in TemplateElement.value.raw, which App.tsx does. A numeric zIndex is matched on raw rather
// than value, since esquery applies a regex attribute test only to strings, and it needs a variant
// for a quoted key, for a negative value, which the parser gives as a unary minus over the digits and
// never as a literal carrying the sign, and for an assignment to element.style.zIndex.
//
// Two forms still get through: a class assembled by string concatenation, and a value chosen by a
// conditional inside the property. Neither appears anywhere in the tree, and catching either costs a
// false positive on legitimate code. A z-index written straight into a .css file is out of reach too,
// since the block applying this matches TypeScript alone
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
    selector: 'TemplateElement[value.raw=/z-\\[$/]',
    message: INTERPOLATED_CLASS_MESSAGE,
  },
  {
    selector: ":matches(Property[key.name='zIndex'], Property[key.value='zIndex']) > Literal[raw=/^\\d/]",
    message: STACKING_LEVEL_MESSAGE,
  },
  {
    selector:
      ":matches(Property[key.name='zIndex'], Property[key.value='zIndex']) > UnaryExpression > Literal[raw=/^\\d/]",
    message: STACKING_LEVEL_MESSAGE,
  },
  {
    selector:
      ":matches(AssignmentExpression[left.property.name='zIndex'], AssignmentExpression[left.property.value='zIndex']) > Literal[raw=/^\\d/]",
    message: STACKING_LEVEL_MESSAGE,
  },
  {
    selector:
      ":matches(AssignmentExpression[left.property.name='zIndex'], AssignmentExpression[left.property.value='zIndex']) > UnaryExpression > Literal[raw=/^\\d/]",
    message: STACKING_LEVEL_MESSAGE,
  },
  {
    selector: "CallExpression[callee.property.name='setProperty'][arguments.0.value='z-index']",
    message: SET_PROPERTY_MESSAGE,
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
