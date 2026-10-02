// Reads ICS feeds off the main process. Expanding repeats is synchronous, and
// ical.js has known rules that never finish (its issues #318 and #1038); here one
// can only stall this thread, which the main process stops after a while.

import { parentPort } from 'node:worker_threads'
import { readIcs } from './ics'

parentPort!.on('message', ({ id, text, from, to, zone }: { id: number; text: string; from: string; to: string; zone: string }) => {
  try {
    parentPort!.postMessage({ id, result: readIcs(text, from, to, zone) })
  } catch (error) {
    parentPort!.postMessage({ id, error: (error as Error).message })
  }
})
