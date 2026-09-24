import antfu from '@antfu/eslint-config'

export default antfu(
  {
    type: 'app',
    javascript: true,
    typescript: false,
    markdown: false,
    formatters: false,
    ignores: ['skills/**', '.agents/**', '.claude/**'],
  },
  {
    files: ['src/**/*.js', 'vendor/**/*.js'],
    rules: {
      'no-control-regex': 'off',
      'node/prefer-global/process': 'off',
      'antfu/no-top-level-await': 'off',
      'no-undef': 'off',
      'style/max-statements-per-line': 'off',
    },
    languageOptions: {
      globals: {
        Bun: 'readonly',
        process: 'readonly',
      },
    },
  },
)
