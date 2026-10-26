import { PAGE } from './state.js'

function itemKey(state, item) {
  if (!item)
    return null
  switch (state.page) {
    case PAGE.Tools:
      return `${item.name}\0${item.version}`
    case PAGE.Config:
      return item.path
    case PAGE.Console:
      return item.id
    case PAGE.Logs:
      return item
    default:
      return item.name
  }
}

export function captureSelection(app, state = app.state) {
  return itemKey(state, app.visibleItems(state)[state.selected])
}

export function restoreSelection(app, key, state = app.state) {
  const items = app.visibleItems(state)
  const index = key === null ? -1 : items.findIndex(item => itemKey(state, item) === key)
  if (index >= 0)
    state.selected = index
  else if (key !== null)
    state.detailScroll = 0
  state.selected = Math.max(0, Math.min(state.selected, items.length - 1))
  if (!items.length)
    state.detailScroll = 0
}
