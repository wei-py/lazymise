import { fg } from '@opentui/core'
import stringWidth from 'string-width'
import { hintLine, LANGUAGES, t } from '../../config/i18n.js'
import { configTargetItems } from '../overlays.js'
import { clipColumns, filterCommands, filterRegistryTools } from '../state.js'
import { COLORS } from './colors.js'
import { overlayHint } from './hints.js'
import { targetHint } from './panels.js'
import {
  box,
  clipPath,
  displayPath,
  inputLine,
  itemLine,
  renderBox,
  scrollContent,
  windowContent,
  wrap,
} from './primitives.js'

export function renderOverlay(nodes, s, app, width, height) {
  const { overlay, language } = s
  const modalWidth = Math.min(width - 8, 80)
  const modalHeight = height - 4
  const contentWidth = modalWidth - 4
  const capacity = Math.max(0, modalHeight - 3)
  let title = ''
  let lines = []
  let selected = -1
  let counter = ''
  let maxScroll = null

  switch (overlay.type) {
    case 'Help': {
      title = t(language, 'help_title_full')
      const keys = [
        'help_panels',
        'help_move',
        'help_enter_esc',
        'help_tools_line',
        'help_updates_line',
        'help_more_actions',
        'help_global_line',
        'help_config_line',
      ]
      const content = scrollContent(
        keys.flatMap(key => wrap(t(language, key), contentWidth)),
        overlay.scroll,
        capacity,
      )
      lines = content.lines
      counter = content.counter
      maxScroll = content.maxScroll
      break
    }
    case 'Search': {
      title = t(language, 'search_title')
      const range = overlay.range === 'add' ? 'add' : 'local'
      const chip = [
        fg(range === 'local' ? COLORS.focus : COLORS.muted)('local'),
        fg(COLORS.border)(' | '),
        fg(range === 'add' ? COLORS.focus : COLORS.muted)('add'),
      ]
      const input = inputLine(t(language, 'search_prompt', { query: '' }), s.search, contentWidth)
      if (range === 'add') {
        const items = overlay.loading || overlay.loadError ? [] : filterRegistryTools(overlay)
        if (overlay.loading) {
          lines = [chip, input, t(language, 'searching…')]
        }
        else if (overlay.loadError) {
          lines = [chip, input, t(language, 'error: {message}', { message: overlay.error })]
        }
        else if (!s.search) {
          lines = [chip, input, t(language, 'press / to search')]
        }
        else if (!items.length) {
          lines = [chip, input, t(language, 'no results for "{query}"', { query: s.search })]
        }
        else {
          const content = windowContent(
            items.map(item =>
              itemLine(
                item.name,
                item.direct ? t(language, 'registry_direct_spec') : item.description,
                contentWidth,
              ),
            ),
            overlay.selected,
            Math.max(0, capacity - 2),
          )
          lines = [chip, input, ...content.lines]
          selected = content.selected < 0 ? -1 : content.selected + 2
          counter = content.counter
        }
      }
      else {
        lines = [chip, input, t(language, 'filters the current list instantly')]
      }
      break
    }
    case 'ConfigTarget': {
      title = t(language, 'config_target_title')
      if (overlay.mode === 'path') {
        const content = scrollContent(
          [
            ...(overlay.error ? wrap(overlay.error, contentWidth) : []),
            ...wrap(overlay.input, contentWidth),
          ],
          overlay.scroll,
          capacity - 1,
        )
        lines = [
          inputLine(t(language, 'config_target_path'), overlay.input, contentWidth),
          ...content.lines,
        ]
        maxScroll = content.maxScroll
        counter = content.maxScroll ? `PgUp/PgDn ${content.counter}` : ''
        break
      }
      const items = configTargetItems(app, overlay)
      const current = items[overlay.selected]
      const context = [
        ...(overlay.error ? wrap(overlay.error, contentWidth) : []),
        ...(current?.supported === false ? [t(language, 'config_target_unsupported')] : []),
        ...(current?.path ? wrap(current.path, contentWidth) : []),
      ]
      const pathContent = scrollContent(context, overlay.scroll, Math.max(1, capacity - 4))
      const visibleHeader = [
        inputLine(t(language, 'search_prompt', { query: '' }), overlay.search, contentWidth),
        ...pathContent.lines,
      ]
      maxScroll = pathContent.maxScroll
      const entries = items.map((item) => {
        if (item.kind === 'path')
          return t(language, 'config_target_input')
        if (item.kind === 'project')
          return t(language, 'config_target_project')
        const marker = item.path === s.configTarget?.path ? '●' : '○'
        const unsupported = item.supported ? '' : ` [${t(language, 'config_target_unsupported')}]`
        return `${marker} ${clipPath(displayPath(item.path), contentWidth - 2 - stringWidth(unsupported))}${unsupported}`
      })
      const content = windowContent(entries, overlay.selected, capacity - visibleHeader.length)
      lines = [...visibleHeader, ...content.lines]
      selected = content.selected < 0 ? -1 : visibleHeader.length + content.selected
      counter = pathContent.maxScroll
        ? `PgUp/PgDn ${pathContent.counter}  ${content.counter}`
        : content.counter
      break
    }
    case 'Picker': {
      title = t(
        language,
        { registry: 'picker_registry', backends: 'picker_backends', versions: 'picker_versions' }[
          overlay.level
        ],
      );
      ({ lines, selected, counter, maxScroll } = renderPickerContent(
        overlay,
        s,
        contentWidth,
        capacity,
      ))
      break
    }
    case 'CommandPalette': {
      title = t(language, overlay.context ? 'command_context' : 'command_palette')
      const query = inputLine(
        t(language, 'search_prompt', { query: '' }),
        overlay.search || '',
        contentWidth,
      )
      const items = filterCommands(overlay.commands || [], overlay.search)
      const content = windowContent(
        items.map(item => itemLine(item.name, item.description, contentWidth)),
        overlay.selected,
        Math.max(0, capacity - 1),
      )
      lines = [query, ...(items.length ? content.lines : [t(language, 'no_matching_commands')])]
      selected = content.selected < 0 ? -1 : content.selected + 1
      counter = content.counter
      break
    }
    case 'CommandBuilder': {
      title = t(language, 'command_builder', { command: `mise ${overlay.command?.name || ''}` })
      const help = overlay.loading ? t(language, 'loading') : overlay.error || overlay.help || ''
      const helpContent = scrollContent(
        wrap(help, contentWidth),
        overlay.scroll,
        Math.max(0, capacity - 1),
      )
      lines = [
        inputLine(
          t(language, 'command_builder_args', { args: '' }),
          overlay.args || '',
          contentWidth,
        ),
        ...helpContent.lines,
      ]
      selected
        = overlay.mode === 'input'
          ? 0
          : helpContent.lines.length
            ? overlay.scroll >= helpContent.maxScroll && helpContent.maxScroll > 0
              ? lines.length - 1
              : 1
            : -1
      counter = helpContent.counter
      maxScroll = helpContent.maxScroll
      break
    }
    case 'CustomTool': {
      title = t(language, 'custom_tool')
      const content = scrollContent(
        [
          ...(overlay.error ? wrap(overlay.error, contentWidth) : []),
          ...wrap(targetHint(s), contentWidth),
        ],
        overlay.scroll,
        capacity - 1,
      )
      lines = [
        inputLine(t(language, 'custom_tool_prompt'), overlay.input || '', contentWidth),
        ...content.lines,
      ]
      maxScroll = content.maxScroll
      counter = content.maxScroll ? `PgUp/PgDn ${content.counter}` : ''
      break
    }
    case 'ConfirmDelete':
    case 'ConfirmCommand': {
      title = t(
        language,
        overlay.type === 'ConfirmDelete' ? 'confirm_delete_title' : 'confirm_command_title',
      )
      const content = scrollContent(
        wrap(overlay.message || '', contentWidth),
        overlay.scroll,
        capacity,
      )
      lines = content.lines
      counter = content.counter
      maxScroll = content.maxScroll
      break
    }
    case 'Settings': {
      title = t(language, 'Settings')
      const languageName = LANGUAGES.find(item => item.id === s.language)?.name || s.language
      lines = [
        `${t(language, 'Language')}: ${languageName}`,
        `${t(language, 'Theme')}: ${s.theme}`,
      ]
      selected = overlay.cursor ?? 0
      break
    }
    case 'Quit': {
      title = t(language, 'Quit?')
      const content = scrollContent(
        wrap(overlay.message || '', contentWidth),
        overlay.scroll,
        capacity,
      )
      lines = content.lines
      counter = content.counter
      maxScroll = content.maxScroll
      break
    }
  }

  lines = lines
    .slice(0, capacity)
    .map(line => (typeof line === 'string' ? clipColumns(line, contentWidth) : line))
  // Hints remain on the bottom row even while long content scrolls above them.
  lines.push(clipColumns(hintLine(overlayHint(overlay, language)), contentWidth))
  const left = Math.floor((width - modalWidth) / 2)
  const renderedHeight = lines.length + 2
  const top = Math.floor((height - renderedHeight) / 2)
  renderBox(
    nodes,
    'modal',
    box(
      'modal',
      left,
      top,
      modalWidth,
      renderedHeight,
      { title, lines, selected, counter },
      COLORS.focus,
      COLORS.text,
      COLORS.surface,
    ),
  )
  return maxScroll
}

export function renderPickerContent(overlay, s, contentWidth, capacity) {
  const { language } = s
  let entries = []
  let emptyKey = 'no_results'
  const header = wrap(
    overlay.intent === 'Install' ? t(language, 'install_only_hint') : targetHint(s),
    contentWidth,
  )
  switch (overlay.level) {
    case 'registry': {
      const filter = overlay.backends?.[overlay.filterIdx || 0] || 'All'
      header.push(
        t(language, 'picker_filter_label', {
          filter: filter === 'All' ? t(language, 'all_backends') : filter,
          query: `${overlay.search || ''}${overlay.searching ? '█' : ''}`,
        }),
      )
      emptyKey = overlay.search ? 'registry_no_match' : 'no_results'
      entries = filterRegistryTools(overlay).map(item =>
        itemLine(
          item.name,
          item.direct ? t(language, 'registry_direct_spec') : item.description,
          contentWidth,
        ),
      )
      break
    }
    case 'backends':
      entries = overlay.backendList || []
      emptyKey = 'no_backends'
      break
    case 'versions':
      header.push(clipPath(overlay.toolSpecName || '', contentWidth))
      entries = (overlay.versions || []).map(item =>
        itemLine(item.version, item.created_at || '', contentWidth),
      )
      emptyKey = 'no_versions'
      break
  }
  if (overlay.loading) {
    header.push(
      t(language, overlay.level === 'registry' ? 'loading_registry' : 'loading_versions'),
    )
  }
  if (overlay.error)
    header.unshift(...wrap(overlay.error, contentWidth))
  const context = scrollContent(header, overlay.scroll, Math.max(0, capacity - 1))
  const visibleHeader = context.lines
  const content = windowContent(
    entries,
    Math.max(0, Math.min(overlay.selected || 0, entries.length - 1)),
    capacity - visibleHeader.length,
  )
  return {
    lines: [...visibleHeader, ...(entries.length ? content.lines : wrap(t(language, emptyKey), contentWidth))],
    selected: content.selected < 0 ? -1 : content.selected + visibleHeader.length,
    counter: context.maxScroll
      ? `PgUp/PgDn ${context.counter}  ${content.counter}`
      : content.counter,
    maxScroll: context.maxScroll,
  }
}
