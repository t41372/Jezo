// The terminal dialogs extensions ask for become cards in a conversation.
// Requests keep their own IDs so parallel tools cannot answer one another.

import { BrowserWindow } from 'electron'
import type { ExtensionUIContext, ExtensionUIDialogOptions } from '@earendil-works/pi-coding-agent'
import type { ExtensionNotice, ExtensionQuestion } from '../../shared/install'
import { newId } from '../workspace/files'
import { piTheme } from '../install/pi-internals'

interface Pending {
  session: string
  question: ExtensionQuestion
  finish: (answer?: string | boolean) => void
}

export class ExtensionUI {
  private pending = new Map<string, Pending>()
  private closed = false

  constructor(private show: (session: string, question: ExtensionQuestion) => void) {}

  answer(session: string, id: string, value?: string | boolean) {
    const request = this.pending.get(id)
    if (!request || request.session !== session) return
    const q = request.question
    if (value !== undefined && (q.kind === 'confirm' ? typeof value !== 'boolean' : typeof value !== 'string')) throw new Error('The answer has the wrong type.')
    if (q.kind === 'select' && value !== undefined && !q.options?.includes(value as string)) throw new Error('Choose an option from this question.')
    request.finish(value)
  }

  isPending(session: string, id: string) { return this.pending.get(id)?.session === session }

  cancel(session?: string) {
    for (const pending of this.pending.values()) if (!session || pending.session === session) pending.finish()
  }

  close() { this.closed = true; this.cancel() }

  private ask(session: string, question: Omit<ExtensionQuestion, 'id'>, opts?: ExtensionUIDialogOptions): Promise<string | boolean | undefined> {
    if (this.closed || opts?.signal?.aborted) return Promise.resolve(undefined)
    const q: ExtensionQuestion = { ...question, id: newId('ui'), ...(opts?.timeout !== undefined ? { expires: Date.now() + opts.timeout } : {}) }
    return new Promise((resolve) => {
      let timer: NodeJS.Timeout | undefined
      const cancel = () => finish()
      const finish = (answer?: string | boolean) => {
        if (!this.pending.delete(q.id)) return
        clearTimeout(timer)
        opts?.signal?.removeEventListener('abort', cancel)
        q.answered = true
        q.answer = answer
        this.show(session, q)
        resolve(answer)
      }
      this.pending.set(q.id, { session, question: q, finish })
      opts?.signal?.addEventListener('abort', cancel, { once: true })
      if (opts?.timeout !== undefined) timer = setTimeout(cancel, opts.timeout)
      this.show(session, q)
    })
  }

  async context(session: string): Promise<ExtensionUIContext> {
    const { theme } = await piTheme()
    const noop = () => {}
    return {
      select: async (title, options, opts) => await this.ask(session, { kind: 'select', title, options }, opts) as string | undefined,
      confirm: async (title, message, opts) => await this.ask(session, { kind: 'confirm', title, message }, opts) === true,
      input: async (title, placeholder, opts) => await this.ask(session, { kind: 'input', title, placeholder }, opts) as string | undefined,
      editor: async (title, placeholder) => await this.ask(session, { kind: 'input', title, placeholder }) as string | undefined,
      notify: (message, type = 'info') => {
        const notice: ExtensionNotice = { message, type }
        for (const window of BrowserWindow.getAllWindows()) window.webContents.send('agent:notice', notice)
      },
      custom: async <T>() => { console.info('pi extension requested a custom terminal component; Jezo cannot display it.'); return undefined as T },
      onTerminalInput: () => noop, setStatus: noop, setWorkingMessage: noop, setWorkingVisible: noop, setWorkingIndicator: noop,
      setHiddenThinkingLabel: noop, setWidget: noop, setFooter: noop, setHeader: noop, setTitle: noop,
      pasteToEditor: noop, setEditorText: noop, getEditorText: () => '', addAutocompleteProvider: noop,
      setEditorComponent: noop, getEditorComponent: () => undefined,
      theme, getAllThemes: () => [], getTheme: () => undefined, setTheme: () => ({ success: false, error: 'Terminal themes do not change Jezo’s interface.' }),
      getToolsExpanded: () => false, setToolsExpanded: noop,
    }
  }
}
