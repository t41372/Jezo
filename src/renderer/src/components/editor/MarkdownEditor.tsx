import { Crepe } from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
import { remarkPluginsCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import { replaceAll } from '@milkdown/kit/utils'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import './editor.css'

/**
 * A todo's notes, edited like a Notion page and saved as plain markdown: the file
 * stays the truth, and the agent reads and writes the same text (docs/design/frontend.md,
 * "Todo details"). Milkdown's Crepe, mounted by hand since it isn't a React component.
 */
type Tree = { type: string; title?: string | null; children?: Tree[] }

/**
 * Crepe's image block takes an image's title as its caption and fails on an
 * image without one, which is how people and the agent write them. An empty
 * title isn't written back out, so the file doesn't change.
 */
function untitledImages(tree: Tree) {
  if (tree.type === 'image' && tree.title == null) tree.title = ''
  tree.children?.forEach(untitledImages)
}

export function MarkdownEditor({ value, onSave, upload, display, placeholder }: {
  value: string
  onSave: (markdown: string) => void
  /** Stores a pasted or dropped image and returns the link the markdown keeps. */
  upload?: (file: File) => Promise<string>
  /** The address an image link in the markdown loads from. */
  display?: (url: string) => string
  placeholder?: string
}) {
  const { t } = useTranslation()
  const root = useRef<HTMLDivElement>(null)
  const crepe = useRef<Crepe | null>(null)
  // What the file says, as last loaded or saved. The editor differs from it only while the user types.
  const saved = useRef(value)
  const typing = useRef(false)
  const save = useRef(onSave)
  save.current = onSave

  useEffect(() => {
    const editor = new Crepe({
      root: root.current,
      defaultValue: value,
      features: { [Crepe.Feature.AI]: false, [Crepe.Feature.TopBar]: false, [Crepe.Feature.Latex]: false, [Crepe.Feature.CodeMirror]: false },
      featureConfigs: {
        [Crepe.Feature.Placeholder]: { text: placeholder ?? '', mode: 'doc' },
        [Crepe.Feature.ImageBlock]: {
          ...(upload && { onUpload: upload, blockOnUpload: upload, inlineOnUpload: upload }),
          ...(display && { proxyDomURL: display }),
          blockUploadButton: t('editor.upload'),
          blockUploadPlaceholderText: t('editor.imageLink'),
          blockCaptionPlaceholderText: t('editor.caption'),
          blockConfirmButton: t('editor.confirm'),
          inlineUploadButton: t('editor.upload'),
          inlineUploadPlaceholderText: t('editor.imageLink'),
          inlineConfirmButton: t('editor.confirm'),
        },
        [Crepe.Feature.LinkTooltip]: { inputPlaceholder: t('editor.linkPlaceholder') },
        [Crepe.Feature.BlockEdit]: {
          textGroup: {
            label: t('editor.menu.text'),
            text: { label: t('editor.menu.paragraph') },
            h1: { label: t('editor.menu.h1') },
            h2: { label: t('editor.menu.h2') },
            h3: { label: t('editor.menu.h3') },
            h4: null,
            h5: null,
            h6: null,
            quote: { label: t('editor.menu.quote') },
            divider: { label: t('editor.menu.divider') },
          },
          listGroup: {
            label: t('editor.menu.lists'),
            bulletList: { label: t('editor.menu.bullets') },
            orderedList: { label: t('editor.menu.numbers') },
            taskList: { label: t('editor.menu.tasks') },
          },
          advancedGroup: {
            label: t('editor.menu.more'),
            image: { label: t('editor.menu.image') },
            codeBlock: { label: t('editor.menu.code') },
            table: { label: t('editor.menu.table') },
            math: null,
          },
        },
      },
    })
    // Write markdown the way the agent and most editors do, so saving changes only what was edited.
    editor.editor.config((ctx) => {
      ctx.update(remarkPluginsCtx, (plugins) => [...plugins, { plugin: () => untitledImages, options: {} }])
      ctx.update(remarkStringifyOptionsCtx, (options) => ({ ...options, bullet: '-' as const, emphasis: '*' as const, strong: '*' as const, rule: '-' as const, listItemIndent: 'one' as const, fences: true }))
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    const flush = () => {
      clearTimeout(timer)
      if (!typing.current) return
      typing.current = false
      const markdown = editor.getMarkdown()
      if (markdown.trim() === saved.current.trim()) return
      saved.current = markdown
      save.current(markdown)
    }
    editor.on((listener) => {
      listener.markdownUpdated((_, markdown) => {
        if (markdown.trim() === saved.current.trim()) return
        typing.current = true
        clearTimeout(timer)
        timer = setTimeout(flush, 800)
      })
      listener.blur(flush)
    })
    const created = editor.create().then(() => {
      crepe.current = editor
    })
    return () => {
      flush()
      crepe.current = null
      // React mounts twice in development; destroy only what was created.
      void created.then(() => editor.destroy())
    }
  }, [])

  // The file changed underneath, by the agent or another editor: take it, unless the user is mid-edit, whose save then wins.
  useEffect(() => {
    if (value.trim() === saved.current.trim() || typing.current) return
    saved.current = value
    crepe.current?.editor.action(replaceAll(value))
  }, [value])

  return <div ref={root} className="jezo-editor" data-editor />
}
