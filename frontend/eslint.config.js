import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'
import pluginVue from 'eslint-plugin-vue'
import importX from 'eslint-plugin-import-x'
import globals from 'globals'

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{ts,mts,tsx,js,mjs,vue}'],
  },

  {
    name: 'app/files-to-ignore',
    ignores: ['**/dist/**', '**/node_modules/**'],
  },

  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,
  skipFormatting,

  importX.configs['flat/recommended'],
  {
    name: 'app/import-settings',
    settings: {
      'import-x/resolver': {
        typescript: true,
      },
    },
    rules: {
      'import-x/first': 'error',
      'import-x/newline-after-import': 'error',
      'import-x/order': [
        'error',
        {
          pathGroups: [
            {
              pattern: '#/**',
              group: 'external',
            },
            {
              pattern: '@/**',
              group: 'parent',
            },
            {
              pattern: '.*/**',
              group: 'sibling',
            },
            {
              pattern: '../../**',
              group: 'sibling',
            },
          ],
          'newlines-between': 'always',
        },
      ],
    },
  },

  {
    // The core barrel is the seam: src/ must not reach past it. The rule
    // mirrors modules/core/test/barrel.spec.ts, which enforces the same
    // property and additionally checks that every imported name is exported.
    name: 'app/core-seam',
    files: ['src/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Deep imports past the barrel: '#/core/<something>' (the
              // bare '#/core' stays allowed) and any path into core's lib/.
              regex: '^(#\\/core\\/.+|.*modules\\/core\\/.*\\/lib\\/.*)$',
              message:
                'Import from "#/core" instead: the core barrel is the seam.',
            },
          ],
        },
      ],
    },
  },

  {
    name: 'app/globals',
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
      },
    },
    rules: {
      'prefer-const': 'error',
      'no-else-return': 'error',
      camelcase: 'error',
      'no-return-assign': 'error',
      'prefer-destructuring': [
        'error',
        {
          object: true,
          array: false,
        },
      ],
      curly: ['error', 'all'],
      'no-unused-expressions': 'error',
      'object-shorthand': [
        'error',
        'always',
        {
          avoidQuotes: true,
          avoidExplicitReturnArrows: true,
        },
      ],
      'no-loss-of-precision': 'error',
      'no-promise-executor-return': 'error',
      'no-useless-backreference': 'error',
      'no-throw-literal': 'error',
      'array-callback-return': 'error',
      'consistent-return': 'error',
      'dot-notation': 'error',
      'no-extend-native': 'error',
      'no-lone-blocks': 'error',
      'no-multi-str': 'error',
      'no-proto': 'error',
      'prefer-template': 'error',
      'prefer-arrow-callback': 'error',
      'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: 'return' },
        {
          blankLine: 'always',
          prev: '*',
          next: ['multiline-block-like', 'multiline-const', 'multiline-let'],
        },
        {
          blankLine: 'always',
          prev: ['multiline-block-like', 'multiline-const', 'multiline-let'],
          next: '*',
        },
        { blankLine: 'always', prev: 'export', next: '*' },
        { blankLine: 'always', prev: '*', next: 'export' },
        { blankLine: 'always', prev: 'singleline-const', next: '*' },
        { blankLine: 'always', prev: 'singleline-let', next: '*' },
        { blankLine: 'always', prev: '*', next: 'singleline-const' },
        { blankLine: 'always', prev: '*', next: 'singleline-let' },
        { blankLine: 'any', prev: 'singleline-let', next: 'singleline-let' },
        { blankLine: 'any', prev: 'singleline-const', next: 'singleline-const' },
      ],

      'vue/html-self-closing': [
        'error',
        {
          html: {
            void: 'always',
            normal: 'always',
            component: 'always',
          },
          svg: 'always',
          math: 'always',
        },
      ],
      'vue/attributes-order': 'error',
      'vue/order-in-components': 'error',
      'vue/no-empty-component-block': 'error',
      'vue/max-attributes-per-line': 0,
      'vue/singleline-html-element-content-newline': 0,
    },
  },
)
