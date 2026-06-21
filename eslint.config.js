import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'src-tauri/target', '.claude']),
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
      // Enforce the radius scale (DESIGN.md "Radius Scale (App)"): no bare
      // `rounded` (Tailwind v4 alias hardcoded to 4px, ignores --radius) and
      // no arbitrary `rounded-[Npx]`. Use rounded-xs/md/lg/xl/full.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/(^|\\s)rounded(\\s|$)/]',
          message: 'Use a radius token (rounded-xs/md/lg/xl/full), not bare `rounded` — it ignores --radius. See DESIGN.md "Radius Scale (App)".',
        },
        {
          selector: 'TemplateElement[value.raw=/(^|\\s)rounded(\\s|$)/]',
          message: 'Use a radius token (rounded-xs/md/lg/xl/full), not bare `rounded` — it ignores --radius. See DESIGN.md "Radius Scale (App)".',
        },
        {
          selector: 'Literal[value=/rounded-\\[/]',
          message: 'No arbitrary radius values. Use rounded-xs/md/lg/xl. See DESIGN.md "Radius Scale (App)".',
        },
        {
          selector: 'TemplateElement[value.raw=/rounded-\\[/]',
          message: 'No arbitrary radius values. Use rounded-xs/md/lg/xl. See DESIGN.md "Radius Scale (App)".',
        },
      ],
    },
  },
])
