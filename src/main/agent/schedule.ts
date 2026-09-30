// The sessions Jezo starts on its own: planning the day in the morning, and a
// check-in in the evening (docs/design/backend.md, "Scheduled sessions").

import { Notification } from 'electron'
import type { Trigger } from '../../shared/session'
import { getConfig } from '../config'
import type { AgentHost } from './host'
import type { Providers } from './providers'

const pad = (n: number) => String(n).padStart(2, '0')
const today = (at: Date) => `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/**
 * The last minute of the day a session may still start when Jezo wasn't
 * running at its time: two hours late at most, except that the plan for the
 * day is still worth making until early afternoon.
 */
const latest = (trigger: Trigger, due: number) => (trigger === 'morning' ? Math.max(14 * 60, due + 120) : due + 120)

export class Schedule {
  private timer: NodeJS.Timeout | null = null
  private starting = new Set<Trigger>()

  constructor(
    private host: AgentHost,
    private providers: Providers,
    private openSession: (id: string) => void,
  ) {
    host.onFinished((id, trigger) => {
      if (trigger === 'morning' || trigger === 'evening') this.notify(id, trigger)
    })
  }

  start() {
    this.timer = setInterval(() => void this.tick(), 30_000)
    // Right after launch, catch up on a session that was missed while Jezo was closed.
    setTimeout(() => void this.tick(), 10_000)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
  }

  private async tick(now = new Date()) {
    const { schedule } = getConfig()
    for (const trigger of ['morning', 'evening'] as const) {
      const at = schedule[trigger]
      if (!at || this.starting.has(trigger)) continue
      const current = now.getHours() * 60 + now.getMinutes()
      const due = minutes(at)
      if (current < due || current > latest(trigger, due)) continue
      if (this.host.list().some((s) => s.trigger === trigger && s.date === today(now))) continue
      // Without a model it would only record a failure every day.
      if (!this.providers.model('background')) continue
      this.starting.add(trigger)
      try {
        await this.host.start(trigger)
      } finally {
        this.starting.delete(trigger)
      }
    }
  }

  /** Says the session is ready. Clicking it opens the conversation. */
  private notify(id: string, trigger: 'morning' | 'evening') {
    if (!Notification.isSupported()) return
    const zh = language === 'zh-TW'
    const body = {
      morning: zh ? '今天的安排提好了，看一下再決定。' : "Today's plan is ready for you to look at.",
      evening: zh ? '聊聊今天怎麼樣？' : 'How did today go?',
    }[trigger]
    const notification = new Notification({ title: 'Jezo', body, silent: trigger === 'evening' })
    notification.on('click', () => this.openSession(id))
    notification.show()
  }
}

let language = 'en'
/** The windows tell the main process which language the app is in, for notifications. */
export const setLanguage = (value: string) => {
  language = value
}
