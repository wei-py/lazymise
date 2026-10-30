import stringWidth from 'string-width'

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })

export const PAGE = {
  Dashboard: 'Dashboard',
  Tools: 'Tools',
  Updates: 'Updates',
  Tasks: 'Tasks',
  Environment: 'Environment',
  Config: 'Config',
  System: 'System',
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
  PAGE.Logs,
]

export const GROUPS = [
  { id: 'Group1', pages: [PAGE.Tools, PAGE.Updates] },
  { id: 'Group2', pages: [PAGE.Tasks, PAGE.Console] },
  { id: 'Group3', pages: [PAGE.Environment, PAGE.Config] },
  { id: 'Group4', pages: [PAGE.Dashboard, PAGE.System, PAGE.Logs] },
]

export const FOCUS = {
  Navigation: 'Navigation',
  Group1: 'Group1',
  Group2: 'Group2',
  Group3: 'Group3',
  Group4: 'Group4',
  Details: 'Details',
}

export function pageGroup(page) {
  return GROUPS.findIndex(group => group.pages.includes(page))
}

export function emptyPosition() {
  return { selected: 0, detailScroll: 0, search: '', listStart: 0 }
}

export const TOOL_SCOPE = {
  Project: 'project',
  Global: 'global',
}

export const VERSION_INTENT = {
  Add: 'Add',
  Use: 'Use',
  Install: 'Install',
}

export function layoutMode(width, height) {
  if (width < 40 || height < 10)
    return 'small'
  if (width >= 100 && height >= 30)
    return 'wide'
  if (width >= 80)
    return 'focused'
  return 'stacked'
}

export function focusSeq(focusedGroup = 0) {
  return [FOCUS.Navigation, GROUPS[focusedGroup].id, FOCUS.Details]
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

export function supportsConfigTarget(path) {
  return path.endsWith('.toml') && path.split(/[\\/]/).at(-1) !== 'rust-toolchain.toml'
}

export function filterCommands(commands, query) {
  return query
    ? commands.filter(
        command =>
          containsCaseInsensitive(command.name, query)
          || containsCaseInsensitive(command.description || '', query),
      )
    : commands
}

export function containsCaseInsensitive(value, query) {
  if (!query)
    return true
  return value.toLowerCase().includes(query.toLowerCase())
}

const BACKEND_SPEC = /^([a-z][a-z0-9+.-]*):(\S+)$/i

/** Parse a query typed as a full backend spec, e.g. npm:uapp or cargo:ex@1.2.3. */
export function parseSpecQuery(query) {
  const spec = (query || '').trim()
  const match = BACKEND_SPEC.exec(spec)
  if (!match)
    return null
  const [, backend, name] = match
  return { spec, backend, name, pinned: name.lastIndexOf('@') > 0 }
}

export function filterRegistryTools(overlay) {
  const tools = overlay.tools || []
  const query = (overlay.search || '').trim()
  let filtered = tools
  if (query) {
    const needle = query.toLowerCase()
    filtered = tools.filter(
      tool =>
        tool.name.toLowerCase().includes(needle)
        || (tool.description && tool.description.toLowerCase().includes(needle))
        || (tool.backends || []).some(backend =>
          `${backend}:${tool.name}`.toLowerCase().includes(needle)),
    )
  }
  if (overlay.filterIdx > 0 && overlay.backends) {
    const backend = overlay.backends[overlay.filterIdx]
    filtered = filtered.filter(tool => tool.backends && tool.backends.includes(backend))
  }
  const direct = parseSpecQuery(query)
  if (
    direct
    && !tools.some(
      tool =>
        tool.name.toLowerCase() === direct.name.toLowerCase()
        && (tool.backends || []).some(backend => backend.toLowerCase() === direct.backend.toLowerCase()),
    )
  ) {
    filtered = [
      { name: direct.spec, backends: [], description: '', direct: true, pinned: direct.pinned },
      ...filtered,
    ]
  }
  return filtered
}
