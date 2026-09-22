import stringWidth from 'string-width'
import { LANGUAGES } from '../config/i18n.js'
import { THEMES } from '../config/themes.js'

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })

export const PAGE = {
  Dashboard: 'Dashboard',
  Tools: 'Tools',
  Updates: 'Updates',
  Tasks: 'Tasks',
  Environment: 'Environment',
  Config: 'Config',
  System: 'System',
  Preferences: 'Preferences',
  Logs: 'Logs',
  Console: 'Console',
}

export const PAGE_ORDER = [
  PAGE.Dashboard,
  PAGE.Tools,
  PAGE.Updates,
  PAGE.Tasks,
  PAGE.Console,
  PAGE.Environment,
  PAGE.Config,
  PAGE.System,
  PAGE.Preferences,
  PAGE.Logs,
]

export const FOCUS = {
  Navigation: 'Navigation',
  List: 'List',
  Details: 'Details',
}

export const VERSION_INTENT = {
  Add: 'Add',
  Use: 'Use',
  Install: 'Install',
}

export const OVERLAY_TYPE = {
  None: null,
  Help: 'Help',
  Search: 'Search',
  Picker: 'Picker',
  CommandPalette: 'CommandPalette',
  CommandBuilder: 'CommandBuilder',
  CustomTool: 'CustomTool',
  ConfigTarget: 'ConfigTarget',
  ConfirmDelete: 'ConfirmDelete',
  ConfirmCommand: 'ConfirmCommand',
}

export function layoutMode(width, height) {
  if (width < 60 || height < 8)
    return 'small'
  if (width >= 100)
    return 'dual'
  if (width >= 60)
    return 'single'
  return 'small'
}

/** Preferences list: languages first so their indexes stay stable, then theme palettes. */
export function preferenceItems() {
  return [
    ...LANGUAGES.map(item => ({ kind: 'language', id: item.id, name: item.name })),
    ...THEMES.map(theme => ({ kind: 'theme', id: theme.id, name: theme.name })),
  ]
}

export function focusSeq() {
  return [FOCUS.Navigation, FOCUS.List, FOCUS.Details]
}

export function moveIndex(current, delta, len) {
  if (len <= 0)
    return 0
  const next = (current + delta) % len
  return next < 0 ? next + len : next
}

export function clipColumns(value, width) {
  if (!value || width <= 0)
    return ''
  if (stringWidth(value) <= width)
    return value
  let result = ''
  let columns = 0
  for (const { segment } of segmenter.segment(value)) {
    const size = stringWidth(segment)
    if (columns + size > width - 1)
      break
    result += segment
    columns += size
  }
  return `${result}…`
}

export function deleteLastGrapheme(value) {
  let last = 0
  for (const segment of segmenter.segment(value))
    last = segment.index
  return value.slice(0, last)
}

export function supportsConfigTarget(path) {
  return path.endsWith('.toml') && path.split(/[\\/]/).at(-1) !== 'rust-toolchain.toml'
}

export function filterCommands(commands, query) {
  return query
    ? commands.filter(command => containsCaseInsensitive(command.name, query)
      || containsCaseInsensitive(command.description || '', query))
    : commands
}

export function containsCaseInsensitive(value, query) {
  if (!query)
    return true
  return value.toLowerCase().includes(query.toLowerCase())
}

export function filterRegistryTools(overlay) {
  let filtered = overlay.tools || []
  if (overlay.search) {
    const query = overlay.search.toLowerCase()
    filtered = filtered.filter(tool => tool.name.toLowerCase().includes(query)
      || (tool.description && tool.description.toLowerCase().includes(query)))
  }
  if (overlay.filterIdx > 0 && overlay.backends) {
    const backend = overlay.backends[overlay.filterIdx]
    filtered = filtered.filter(tool => tool.backends && tool.backends.includes(backend))
  }
  return filtered
}
