import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config({ ignores: ['node_modules/**', '**/node_modules/**', '**/dist/**', '**/dist-cloud/**', '**/lib/**', 'frontend/**', '.runtime/**', '.cache/**', 'outputs/**', 'test-results/**', 'playwright-report/**'] }, js.configs.recommended, ...ts.configs.recommended, { files: ['**/*.mjs'], languageOptions: { globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly', fetch: 'readonly', setTimeout: 'readonly' } } });
