import { defineConfig } from 'eslint/config';
import raycastConfig from '@raycast/eslint-config';

export default defineConfig([
  {
    ignores: [
      '.venv/**',
      'apps/prospect-web/**',
      'npid-api-layer/**',
      'mcp-servers/**',
      'raycast-env.d.ts',
      'scripts/scriptable/**',
      'src/python/**',
      'src/lib/prospect-pipeline/**',
      'swift/contacts/.build/**',
      'swift/contacts/.raycast-swift-build/**',
    ],
  },
  ...raycastConfig,
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
]);
