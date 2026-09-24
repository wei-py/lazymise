import { hintSegments } from '../../config/i18n.js'
import { FOCUS } from '../state.js'

export function pageActionsHint(s) {
  const lang = s.language
  if (s.overlay)
    return overlayHint(s.overlay, lang)
  if (s.focus === FOCUS.Navigation)
    return hintSegments(lang, 'navigation_hint')
  if (s.focus === FOCUS.Details)
    return hintSegments(lang, 'details_hint')
  switch (s.page) {
    case 'Dashboard':
      return hintSegments(lang, 'dashboard_hint')
    case 'Tools':
      return hintSegments(lang, 'tools_hint')
    case 'Updates':
      return hintSegments(lang, 'updates_hint')
    case 'Tasks':
      return hintSegments(lang, 'tasks_hint')
    case 'Environment':
      return hintSegments(lang, 'environment_hint')
    case 'Config':
      return hintSegments(lang, 'config_hint')
    case 'Console':
      return hintSegments(lang, 'console_hint')
    case 'System':
      return hintSegments(lang, 'system_hint')
    case 'Logs':
      return hintSegments(lang, 'logs_hint')
    default:
      return []
  }
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
