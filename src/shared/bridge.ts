// What the preload script exposes to the renderer as `window.jezo`.

export type ThemeSource = 'system' | 'light' | 'dark'

/** What the ⌥X window is asked to do. */
export type QuickCommand =
  | { kind: 'type' }
  /** ⌥X is being held: listen. `context` is the page the user was looking at in the main window. */
  | { kind: 'voice-start'; context: string | null }
  /** ⌥X was released: stop listening and send what was said. */
  | { kind: 'voice-end' }

export interface QuickSubmission {
  text: string
  as: 'ask' | 'note'
}

export interface JezoBridge {
  /** process.platform: "darwin", "win32", "linux", … */
  platform: string
  setTheme(source: ThemeSource): void
  /** Tells the ⌥X window which page the main window shows, so voice can bring it along as context. */
  setContext(pageTitle: string): void
  quick: {
    /** Whether holding ⌥X to talk works on this machine. */
    canHold(): Promise<boolean>
    /**
     * Sends text from the ⌥X window to the main window: `ask` continues the
     * conversation there and brings the window forward; `note` files it in
     * 隨手記 and leaves the user where they are.
     */
    submit(text: string, as?: QuickSubmission['as']): void
    hide(): void
    /** Called in the main window when the ⌥X window sends text. */
    onSubmit(listener: (submission: QuickSubmission) => void): () => void
    /** Called in the ⌥X window. */
    onCommand(listener: (command: QuickCommand) => void): () => void
  }
}
