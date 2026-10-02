// Reads ICS feeds in a worker thread, so a repeat rule that never finishes
// stalls the worker rather than Jezo (ics-worker.ts). A read that takes too long
// fails, the worker is replaced, and that calendar counts as unread for the range.

/// <reference types="electron-vite/node" />
import { Worker } from 'node:worker_threads'
import type { Zone } from '../../shared/time'
import type { IcsCalendar } from './ics'
import workerPath from './ics-worker?modulePath'

/** Long enough for a large feed over months; a rule that never ends is well past it. */
const TIMEOUT_MS = 10_000

let worker: Worker | null = null
let next = 0
const waiting = new Map<number, { resolve: (calendar: IcsCalendar) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()

function start() {
  const created = new Worker(workerPath)
  created.on('message', ({ id, result, error }: { id: number; result?: IcsCalendar; error?: string }) => {
    const call = waiting.get(id)
    if (!call) return
    waiting.delete(id)
    clearTimeout(call.timer)
    if (error === undefined) call.resolve(result!)
    else call.reject(new Error(error))
  })
  created.on('error', (error) => stop(created, error instanceof Error ? error : new Error(String(error))))
  created.on('exit', () => stop(created, new Error('The calendar reader stopped.')))
  created.unref()
  return created
}

/** Fails what the worker had and lets the next read start a new one. */
function stop(which: Worker, error: Error) {
  if (worker !== which) return
  worker = null
  void which.terminate()
  for (const [id, call] of waiting) {
    clearTimeout(call.timer)
    call.reject(error)
    waiting.delete(id)
  }
}

/** The events of a feed between two days in `zone`, as readIcs reads them, off the main thread. */
export function readFeed(text: string, from: string, to: string, zone: Zone): Promise<IcsCalendar> {
  const current = (worker ??= start())
  const id = next++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => stop(current, new Error('Reading this calendar took too long; one of its repeat rules may never end.')), TIMEOUT_MS)
    waiting.set(id, { resolve, reject, timer })
    current.postMessage({ id, text, from, to, zone })
  })
}
