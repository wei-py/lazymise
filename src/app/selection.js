import { PAGE } from './state.js'

function itemKey(app, item) {
  if (!item)
    return null
  switch (app.state.page) {
    case PAGE.Tools:
      return `${item.name}\0${item.version}`
    case PAGE.Config:
      return item.path
    case PAGE.Console:
      return item.id
    case PAGE.Logs:
      return item
    case PAGE.Preferences:
      return item.id
    default:
      return item.name
  }
}

export function captureSelection(app) {
  return itemKey(app, app.visibleItems()[app.state.selected])
}

export function restoreSelection(app, key) {
  const index
    = key === null ? -1 : app.visibleItems().findIndex(item => itemKey(app, item) === key)
  if (index >= 0)
    app.state.selected = index
  else app.state.detailScroll = 0
  app.clampSelection()
}
