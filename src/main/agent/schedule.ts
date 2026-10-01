// Automations: sessions Jezo starts on its own at set times, like planning the
// morning (docs/design/backend.md, "Automations"). Each is a file in the
// workspace's automations/items/, with a cron schedule, and its body is what
// the agent is asked. The agent can add and change them like any other file.

import { Cron } from 'croner'
import { Notification } from 'electron'
import type { Schedule as ScheduleTimes } from '../../shared/bridge'
import type { Trigger } from '../../shared/session'
import type { Item } from '../../shared/workspace'
import type { Workspace } from '../workspace/workspace'
import type { AgentHost } from './host'
import type { Providers } from './providers'

/** How late an automation may still start when Jezo wasn't running at its time, unless its file says. */
const LATE_MINUTES = 120

/** The most recent time a schedule was due, at or before now. */
function lastDue(schedule: string, now: Date): Date | null {
  try {
    return new Cron(schedule, { paused: true }).previousRuns(1, now)[0] ?? null
  } catch {
    // A schedule that doesn't parse never runs; the manifest check shows it.
    return null
  }
}

export class Schedule {
  private timer: NodeJS.Timeout | null = null
  private starting = new Set<string>()

  constructor(
    private workspace: Workspace,
    private host: AgentHost,
    private providers: Providers,
    private openSession: (id: string) => void,
  ) {
    host.onFinished((id, automation) => {
      if (automation) this.notify(id, automation.name)
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

  private automations() {
    return this.workspace.list().filter((i) => i.kind === 'automation' && !i.problems?.length)
  }

  private async tick(now = new Date()) {
    const lastRuns = this.host.lastRuns()
    for (const item of this.automations()) {
      const d = item.data as { name: string; schedule: string; state: string; late?: number; trigger?: Trigger }
      if (d.state !== 'on' || this.starting.has(item.id)) continue
      const due = lastDue(d.schedule, now)
      if (!due || now.getTime() - due.getTime() > (d.late ?? LATE_MINUTES) * 60_000) continue
      if ((lastRuns.get(item.id)?.getTime() ?? 0) >= due.getTime()) continue
      // Without a model it would only record a failure every time.
      if (!this.providers.model('background')) continue
      this.starting.add(item.id)
      try {
        await this.host.startAutomation({ id: item.id, name: d.name, trigger: d.trigger, request: item.body.trim() })
      } finally {
        this.starting.delete(item.id)
      }
    }
  }

  /** Runs an automation now, from its page in 更多, whatever its schedule. Returns the conversation. */
  async run(id: string) {
    const item = this.workspace.get(id)
    if (!item || item.kind !== 'automation') throw new Error(`There is no automation ${id}.`)
    const d = item.data as { name: string; trigger?: Trigger }
    return this.host.startAutomation({ id, name: d.name, trigger: d.trigger, request: item.body.trim() })
  }

  /** Says the session is ready. Clicking it opens the conversation. */
  private notify(session: string, name: string) {
    if (!Notification.isSupported()) return
    const body = language === 'zh-TW' ? `「${name}」好了，看一下再決定。` : `“${name}” is ready for you to look at.`
    const notification = new Notification({ title: 'Jezo', body })
    notification.on('click', () => this.openSession(session))
    notification.show()
  }

  // ─── The morning and evening rows in 設定 ───
  // They edit the two built-in automations' times. Other automations are managed in their files.

  times(): ScheduleTimes {
    const time = (id: string) => {
      const item = this.workspace.get(id)
      if (!item || item.data.state !== 'on') return null
      const [minute, hour] = String(item.data.schedule).split(' ')
      return /^\d+$/.test(minute) && /^\d+$/.test(hour) ? `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}` : null
    }
    return { morning: time('a-morning'), evening: time('a-evening') }
  }

  async setTimes(change: Partial<ScheduleTimes>) {
    for (const [kind, value] of Object.entries(change) as [keyof ScheduleTimes, string | null][]) {
      const item: Item | undefined = this.workspace.get(`a-${kind}`)
      if (!item) continue
      if (value === null) {
        await this.workspace.update(item.id, { state: 'off' }, { by: 'user' })
      } else {
        const [hour, minute] = value.split(':').map(Number)
        const rest = String(item.data.schedule).split(' ').slice(2).join(' ') || '* * *'
        await this.workspace.update(item.id, { state: 'on', schedule: `${minute} ${hour} ${rest}` }, { by: 'user' })
      }
    }
    return this.times()
  }
}

let language = 'en'
/** The windows tell the main process which language the app is in, for notifications. */
export const setLanguage = (value: string) => {
  language = value
}
