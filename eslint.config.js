import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  { ignores: ['dist/**', 'dev-dist/**', 'scripts/**'] },
  js.configs.recommended,
  reactHooks.configs.flat['recommended-latest'],
  reactRefresh.configs.vite,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // Destructuring-to-omit (`const { id, ...rest } = x`) is the idiomatic way to
      // drop a field; the binding is unused on purpose.
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
      // Downgraded to a warning on purpose: the rule flags "reset derived state when
      // the input changes", which this codebase uses in 10 places. Rewriting them all
      // to derive-during-render is a risky refactor for a performance smell nobody has
      // hit, in an app whose priority is data reliability. Revisit if renders get slow.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
];
