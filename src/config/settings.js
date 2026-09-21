import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

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
    }
  }
  catch {
    return { language: 'en' }
  }
}

export function saveSettings(settings) {
  const dir = settingsDir()
  try { mkdirSync(dir, { recursive: true }) }
  catch { /* ok */ }
  writeFileSync(settingsPath(), JSON.stringify({ language: settings.language || 'en' }, null, 2))
}
