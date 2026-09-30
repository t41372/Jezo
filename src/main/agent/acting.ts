// Who is acting right now, carried through async calls. A run of the agent sets
// it, so anything the run writes, however deep in pi or an extension, is
// recorded as the agent's, and knows where the words it's acting on came from.

import { AsyncLocalStorage } from 'node:async_hooks'
import type { Actor } from '../workspace/workspace'

export interface Acting {
  actor: Actor
  /** Where the words behind this run come from: "user" when the user wrote or said them, "agent" otherwise. */
  source: 'user' | 'agent'
  /** The conversation's file, relative to the workspace. */
  session?: string
}

export const acting = new AsyncLocalStorage<Acting>()

/** Outside a run, it's the user, through the GUI. */
export const currentActing = (): Acting => acting.getStore() ?? { actor: { by: 'user' }, source: 'user' }
