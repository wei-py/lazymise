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

export const SCOPE = {
  Project: 'Project',
  Global: 'Global',
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
  ConfirmDelete: 'ConfirmDelete',
  ConfirmCommand: 'ConfirmCommand',
}

export function layoutMode(width, _height) {
  if (width >= 100)
    return 'dual'
  if (width >= 60)
    return 'single'
  return 'small'
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
  if (!value)
    return ''
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
  const graphemes = [...segmenter.segment(value)].map(s => s.segment)
  if (graphemes.length <= width)
    return value
  if (width <= 3)
    return '…'.slice(0, width)
  return `${graphemes.slice(0, width - 1).join('')}…`
}

export function containsCaseInsensitive(value, query) {
  if (!query)
    return true
  return value.toLowerCase().includes(query.toLowerCase())
}
