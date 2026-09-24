import { loadSettings as kitLoad, saveSettings as kitSave } from '../../vendor/lazy-kit/settings.js'
import { DEFAULT_THEME, isTheme } from '../../vendor/lazy-kit/themes.js'

const DEFAULTS = { language: 'en', theme: DEFAULT_THEME }

function directory() {
  return process.env.LAZYMISE_CONFIG_DIR
}

export function loadSettings() {
  const settings = kitLoad('lazymise', DEFAULTS, directory())
  return {
    language: settings.language === 'zh' ? 'zh' : 'en',
    theme: isTheme(settings.theme) ? settings.theme : DEFAULT_THEME,
  }
}

export function saveSettings(settings) {
  kitSave(
    'lazymise',
    {
      language: settings.language || 'en',
      theme: isTheme(settings.theme) ? settings.theme : DEFAULT_THEME,
    },
    directory(),
  )
}
