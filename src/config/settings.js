import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_THEME, isTheme } from './themes.js'

function settingsDir() {
  if (process.env.LAZYMISE_CONFIG_DIR)
    return process.env.LAZYMISE_CONFIG_DIR
  const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(xdg, 'lazymise')
}

function settingsPath() {
  return join(settingsDir(), 'settings.json')
}

export function loadSettings() {
  try {
    const raw = readFileSync(settingsPath(), 'utf-8')
    const parsed = JSON.parse(raw)
    return {
      language: parsed.language === 'zh' ? 'zh' : 'en',
      theme: isTheme(parsed.theme) ? parsed.theme : DEFAULT_THEME,
    }
  }
  catch {
    return { language: 'en', theme: DEFAULT_THEME }
  }
}

export function saveSettings(settings) {
  const dir = settingsDir()
  mkdirSync(dir, { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify({ language: settings.language || 'en', theme: isTheme(settings.theme) ? settings.theme : DEFAULT_THEME }, null, 2))
}
