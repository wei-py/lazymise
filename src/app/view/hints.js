import { hintSegments } from '../../config/i18n.js'
import { FOCUS } from '../state.js'

export function pageActionsHint(s) {
  const lang = s.language
  if (s.overlay?.type === 'Help')
    return []
  if (s.overlay)
    return overlayHint(s.overlay, lang)
  if (s.focus === FOCUS.Navigation)
    return hintSegments(lang, 'navigation_hint')
  if (s.focus === FOCUS.Details)
    return hintSegments(lang, 'details_hint')
  let key
  switch (s.page) {
    case 'Dashboard':
      key = 'dashboard_hint'
      break
    case 'Tools':
      key = 'tools_hint'
      break
    case 'Updates':
      key = 'updates_hint'
      break
    case 'Tasks':
      key = 'tasks_hint'
      break
    case 'Environment':
      key = 'environment_hint'
      break
    case 'Config':
      key = 'config_hint'
      break
    case 'Console':
      key = 'console_hint'
      break
    case 'System':
      key = 'system_hint'
      break
    case 'Logs':
      key = 'logs_hint'
      break
    default:
      return []
  }
  return [
    ...hintSegments(lang, s.selected === 0 ? 'list_navigation_hint' : 'list_detail_hint'),
    ...hintSegments(lang, key),
  ]
}

export function overlayHint(overlay, language) {
  if (overlay.type === 'Quit')
    return hintSegments(language, 'quit_actions')
  if (overlay.type === 'Settings')
    return hintSegments(language, 'settings_hint')
  if (overlay.type === 'Search')
    return hintSegments(language, 'search_range_hint')
  if (overlay.type === 'ConfirmCommand' || overlay.type === 'ConfirmDelete')
    return hintSegments(language, 'confirm_prompt')
  if (overlay.searching)
    return hintSegments(language, 'text_search_hint')
  if (overlay.type === 'ConfigTarget') {
    return hintSegments(
      language,
      overlay.mode === 'path' ? 'config_target_path_hint' : 'config_target_list_hint',
    )
  }
  if (overlay.type === 'CustomTool')
    return hintSegments(language, 'custom_tool_hint')
  if (overlay.type === 'CommandBuilder') {
    return hintSegments(
      language,
      overlay.mode === 'help' ? 'builder_help_hint' : 'builder_input_hint',
    )
  }
  if (overlay.type === 'CommandPalette')
    return hintSegments(language, 'palette_hint')
  if (overlay.type === 'Help')
    return hintSegments(language, 'help_scroll_hint')
  if (overlay.loading)
    return hintSegments(language, 'loading_hint')
  if (overlay.type === 'Picker') {
    if (overlay.level === 'registry')
      return hintSegments(language, 'registry_hint')
    return hintSegments(language, overlay.intent === 'Install' ? 'install_hint' : 'picker_hint')
  }
  return []
}
