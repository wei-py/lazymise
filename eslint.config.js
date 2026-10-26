import antfu from '@antfu/eslint-config'

export default antfu(
  {
    type: 'app',
    javascript: true,
    typescript: false,
    markdown: false,
    formatters: false,
    ignores: ['skills/**', '.agents/**', '.claude/**', 'dist/**'],
  },
  {
    files: ['src/**/*.js', 'vendor/**/*.js', 'support/**/*.js', 'scripts/**/*.js'],
    rules: {
      'no-control-regex': 'off',
      'node/prefer-global/process': 'off',
      'antfu/no-top-level-await': 'off',
      'style/max-statements-per-line': 'off',
    },
    languageOptions: {
      globals: {
        process: 'readonly',
      },
    },
  },
)
