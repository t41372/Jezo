import { useTranslation } from 'react-i18next'
import { getWidget, type LayoutNode } from './registry'

/** Renders a page layout. An unknown widget renders a placeholder, never a crash. */
export function Layout({ node }: { node: LayoutNode }) {
  if ('row' in node) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1">
        {node.row.map((child, i) => (
          <Layout key={i} node={child} />
        ))}
      </div>
    )
  }
  if ('column' in node) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {node.column.map((child, i) => (
          <Layout key={i} node={child} />
        ))}
      </div>
    )
  }
  const Widget = getWidget(node.widget)
  if (!Widget) return <MissingWidget id={node.widget} />
  return <Widget {...node.props} />
}

function MissingWidget({ id }: { id: string }) {
  const { t } = useTranslation()
  return (
    <div className="m-4 flex flex-1 items-center justify-center rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
      {t('layout.missingWidget', { id })}
    </div>
  )
}
