import stringWidth from 'string-width'
import { JOB_GLYPH } from '../../../vendor/lazy-kit/jobs.js'
import { t } from '../../config/i18n.js'
import { clipColumns, supportsConfigTarget } from '../state.js'
import { clipPath, displayPath, padColumns, scrollColumns, windowContent, wrap } from './primitives.js'

/** Content list: varies by page. */
export function listContent(s, items, capacity, width, marquee = {}) {
  const { page, snapshot, search, selected, language } = s
  let title = ''
  let renderItem = null
  let scrolling = false
  let rowIndex = -1
  const fit = (value, columns, clip = clipColumns) => {
    if (marquee.enabled && rowIndex === selected && columns > 0 && stringWidth(value) > columns) {
      scrolling = true
      return scrollColumns(value, columns, marquee.step)
    }
    return clip(value, columns)
  }

  switch (page) {
    case 'Dashboard': {
      const stats = [
        t(language, 'dashboard_tools_count', { count: snapshot.tools.length }),
        t(language, 'dashboard_updates_count', {
          count: snapshot.updates.filter(u => u.latest !== u.current).length,
        }),
        t(language, 'dashboard_tasks_count', { count: snapshot.tasks.length }),
        t(language, 'dashboard_configs_count', { count: snapshot.configs.length }),
        '',
        t(language, 'dashboard_version', { version: snapshot.mise_version }),
      ]
      return {
        title: t(language, 'dashboard_title'),
        count: stats.length,
        lines: stats,
        selected: -1,
        counter: '',
      }
    }
    case 'Tools': {
      title = t(language, 'Tools')
      title = `${title} · ${t(language, s.toolViewInstalled ? 'tool_view_installed' : s.toolScope === 'global' ? 'tool_scope_global' : 'tool_scope_project')}`
      renderItem = (tool) => {
        const suffix = `${fit(tool.version, Math.min(12, Math.max(1, Math.floor(width / 3))))}${!tool.active ? ` ${t(language, '(inactive)')}` : ''}`
        const inherited = s.toolScope !== 'global' && tool.scope === 'global' ? '↑ ' : ''
        const nameWidth = Math.max(1, width - stringWidth(suffix) - stringWidth(inherited) - 4)
        return `${tool.installed ? '●' : '○'} ${inherited}${padColumns(fit(tool.name, nameWidth), nameWidth)}  ${suffix}`
      }
      break
    }
    case 'Updates': {
      title = t(language, 'Updates')
      const versionWidth = Math.min(10, Math.max(1, Math.floor(width / 4)))
      const nameWidth = Math.max(1, width - versionWidth * 2 - 11)
      renderItem = u =>
        `${s.selectedUpdates.has(u.name) ? '[x]' : '[ ]'} ${fit(u.name, nameWidth)}  ${fit(u.current, versionWidth)} → ${fit(u.latest, versionWidth)}`
      break
    }
    case 'Tasks': {
      title = t(language, 'Tasks')
      renderItem = t => `  ${fit(t.name, Math.max(1, width - 2))}`
      break
    }
    case 'Environment':
    case 'System': {
      title = t(language, page)
      const nameWidth = Math.min(20, Math.max(1, Math.floor(width / 2)))
      renderItem = cmd => `${fit(cmd.name, nameWidth)}  ${fit(cmd.description, Math.max(1, width - nameWidth - 2))}`
      break
    }
    case 'Config': {
      title = t(language, 'Config')
      renderItem = (c) => {
        const suffix = supportsConfigTarget(c.path) ? '' : ` [${t(language, 'config_target_unsupported')}]`
        return `${s.configTarget?.path === c.path ? '●' : '○'} ${fit(displayPath(c.path), Math.max(1, width - 2 - stringWidth(suffix)), clipPath)}${suffix}`
      }
      break
    }
    case 'Console': {
      title = t(language, 'Console')
      renderItem = (job) => {
        const elapsed = job.startedAt
          ? ` ${Math.round(((job.endedAt || Date.now()) - job.startedAt) / 1000)}s`
          : ''
        return `${JOB_GLYPH[job.state] || '?'} ${fit(job.label, Math.max(1, width - stringWidth(elapsed) - 2))}${elapsed}`
      }
      break
    }
    case 'Logs': {
      title = t(language, 'Command Log')
      renderItem = l => `${l.success ? '✓' : '✗'} ${fit(l.command, Math.max(1, width - 2))}`
      break
    }
  }

  const entries = items.map((item, index) => {
    rowIndex = index
    const line = renderItem(item)
    return fit(line, width)
  })
  const content = windowContent(entries, selected, capacity, s)
  if (!entries.length) {
    content.lines.push(
      search
        ? t(language, 'no results for "{query}"', { query: search })
        : getEmptyMessage(page, language),
    )
  }
  return { title, count: items.length, scrolling, ...content }
}

export function getEmptyMessage(page, language) {
  const map = {
    Tools: 'no_tools',
    Updates: 'no_updates',
    Tasks: 'no_tasks',
    Environment: 'no_commands',
    Config: 'no_configs',
    System: 'no_commands',
    Logs: 'no_logs',
  }
  return t(language, map[page] || 'no_items')
}

/** Detail panel: shows info about selected item. */
export function detailContent(s, items) {
  const { page, snapshot, selected, language } = s

  let lines = []
  const title = `${t(language, page)} · ${t(language, 'Details')}`

  switch (page) {
    case 'Dashboard': {
      lines = [
        t(language, 'dashboard_version', { version: snapshot.mise_version }),
        '',
        t(language, 'dashboard_tools_count', { count: snapshot.tools.length }),
        t(language, 'dashboard_updates_count', { count: snapshot.updates.length }),
        t(language, 'dashboard_tasks_count', { count: snapshot.tasks.length }),
        t(language, 'dashboard_configs_count', { count: snapshot.configs.length }),
        '',
        targetHint(s),
      ]
      break
    }
    case 'Tools': {
      const tool = items[selected]
      if (tool) {
        lines = [
          `${t(language, 'detail_tool')}: ${tool.name}`,
          `${t(language, 'detail_version')}: ${tool.version}`,
          `${t(language, 'detail_requested')}: ${tool.requested || '—'}`,
          tool.scope ? `${t(language, 'detail_origin')}: ${t(language, `tool_scope_${tool.scope}`)}` : '',
          tool.source ? `${t(language, 'detail_source')}: ${tool.source}` : '',
          `${t(language, 'detail_installed')}: ${tool.installed ? t(language, 'installed') : t(language, 'not_installed')}`,
          `${t(language, 'detail_active')}: ${tool.active ? t(language, 'active') : t(language, 'inactive')}`,
          targetHint(s),
          '',
          t(language, 'detail_tools_hint'),
        ].filter(Boolean)
      }
      else {
        lines = [t(language, 'No tool selected')]
      }
      break
    }
    case 'Updates': {
      const update = items[selected]
      if (update) {
        lines = [
          `${t(language, 'detail_tool')}: ${update.name}`,
          `${t(language, 'current')}: ${update.current}`,
          `${t(language, 'latest')}: ${update.latest}`,
          '',
          t(language, 'detail_updates_hint'),
        ]
      }
      else {
        lines = [t(language, 'No update selected')]
      }
      break
    }
    case 'Tasks': {
      const task = items[selected]
      if (task) {
        lines = [
          `${t(language, 'detail_task')}: ${task.name}`,
          `${t(language, 'description')}: ${task.description || '—'}`,
          `${t(language, 'detail_command')}: ${task.command || '—'}`,
          '',
          t(language, 'detail_tasks_hint'),
        ]
      }
      else {
        lines = [t(language, 'No task selected')]
      }
      break
    }
    case 'Environment':
    case 'System': {
      const cmd = items[selected]
      if (cmd) {
        lines = [
          `${t(language, 'detail_command')}: mise ${cmd.name}`,
          `${t(language, 'description')}: ${cmd.description}`,
          '',
          t(language, 'detail_environment_hint'),
        ]
      }
      else {
        lines = [t(language, 'No command selected')]
      }
      break
    }
    case 'Config': {
      const config = items[selected]
      if (config) {
        lines = [
          `${t(language, 'Path')}: ${config.path}`,
          s.configTarget?.path === config.path
            ? t(language, 'config_target_selected', { path: config.path })
            : '',
          supportsConfigTarget(config.path) ? '' : t(language, 'config_target_unsupported'),
          '',
          t(language, 'Tools in config:'),
          ...config.tools.map(t => `  • ${t}`),
          '',
          t(language, 'config_actions'),
        ]
      }
      else {
        lines = [t(language, 'No config selected')]
      }
      break
    }
    case 'Console': {
      const job = items[selected]
      if (job) {
        const statusText
          = {
            queued: t(language, 'console_pending'),
            running: t(language, 'console_running'),
            done: t(language, 'console_done'),
            failed: t(language, 'console_failed'),
            canceled: t(language, 'console_canceled'),
          }[job.state] || job.state
        const elapsed = job.startedAt
          ? Math.round(((job.endedAt || Date.now()) - job.startedAt) / 1000)
          : 0
        lines = [
          `${job.label}`,
          `${t(language, 'Status')}: ${statusText}`,
          `${t(language, 'Duration')}: ${elapsed}s`,
          ...(job.startedAt !== null && job.endedAt !== null && job.state !== 'running'
            ? [
                job.state === 'canceled'
                  ? t(language, 'canceled · {seconds}', { seconds: `${elapsed}s` })
                  : t(language, 'exit {code} · {seconds}', {
                      code: job.exitCode,
                      seconds: `${elapsed}s`,
                    }),
              ]
            : []),
          '',
          job.output || job.lastLine || t(language, '(waiting for output...)'),
        ]
      }
      else {
        lines = [t(language, 'No task selected')]
      }
      break
    }
    case 'Logs': {
      const log = items[selected]
      if (log) {
        lines = [
          `${t(language, 'Command')}: ${log.command}`,
          `${t(language, 'Status')}: ${log.success ? t(language, 'Success') : t(language, 'Failed')}`,
          '',
          log.output,
        ]
      }
      else {
        lines = [t(language, 'No log selected')]
      }
      break
    }
  }

  return { title, lines }
}

export function detailViewport(s, items, width, height) {
  const content = detailContent(s, items)
  const lines = content.lines.flatMap(line => wrap(line, width))
  const capacity = Math.max(0, height)
  const maxScroll
    = items.length || s.page === 'Dashboard' ? Math.max(0, lines.length - capacity) : 0
  const scroll = Math.max(0, Math.min(s.detailScroll, maxScroll))
  return {
    title: content.title,
    count: lines.length,
    lines: lines.slice(scroll, scroll + capacity),
    counter: `${lines.length ? scroll + 1 : 0}–${Math.min(lines.length, scroll + capacity)}/${lines.length}`,
    maxScroll,
  }
}

export function targetHint(s) {
  return t(s.language, 'config_target_selected', {
    path: s.configTarget?.path || t(s.language, 'config_target_none'),
  })
}
