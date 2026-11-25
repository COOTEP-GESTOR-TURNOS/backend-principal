// ESLint (configuración plana). Ejecutar con: npm run lint
// Es .mjs porque el proyecto usa CommonJS (package.json sin "type": "module"). Igual que la web y la app.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/'] },
  {
    files: ['**/*.{js,mjs,ts}'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      complexity: ['warning', { max: 7 }],
    },
  },
);
