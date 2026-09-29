window.__ModuleLoader__.load({
  id: 'dsh-copy-session-id',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')
    const { IconCopyOutlineRegular, MenuItemButton, writeClipboard } = require('@deepseek-ai/dsh-client-ui-primitives')

    function CopySessionIdItem({ sessionId, useMenuOpenState }) {
      const [, setMenuOpen] = useMenuOpenState()
      const [feedback, setFeedback] = React.useState('')

      return React.createElement(MenuItemButton, {
        icon: React.createElement(IconCopyOutlineRegular),
        onSelect: () => {
          // Start the clipboard write in the click handler while user activation is present.
          Promise.resolve(writeClipboard(String(sessionId)))
            .then((ok) => setFeedback(ok ? '已复制会话 ID' : '复制失败，请检查剪贴板权限'))
            .catch(() => setFeedback('复制失败，请检查剪贴板权限'))
            .finally(() => setTimeout(() => setMenuOpen(false), 1400))
        },
      }, React.createElement('span', { role: 'status', 'aria-live': 'polite' }, feedback || '复制会话 ID'))
    }

    module.exports.inject = ['slots']
    module.exports.apply = (ctx) => ctx.slots.inject('sidebar.workspaces.session.menu.item', function* () {
      yield ctx.slots.register({
        name: 'sidebar.workspaces.session.menu.item',
        id: 'dsh-copy-session-id',
        order: 500,
      }, CopySessionIdItem)
    })
    return module.exports
  },
})
