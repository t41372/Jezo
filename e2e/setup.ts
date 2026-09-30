// Loads the tests' model in LM Studio before any test runs. Loaded on request
// instead (just in time), LM Studio may unload it again when the developer's own
// Jezo asks for another model mid-run, and the other way around.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { TEST_MODEL } from './jezo'

export default function setup() {
  const lms = join(homedir(), '.lmstudio/bin/lms')
  if (!existsSync(lms)) return
  try {
    if (execFileSync(lms, ['ps'], { encoding: 'utf8' }).split('\n').some((line) => line.split(/\s+/)[0] === TEST_MODEL)) return
    execFileSync(lms, ['load', TEST_MODEL, '-y'], { stdio: 'inherit' })
  } catch {
    // LM Studio isn't running; the agent tests skip themselves.
  }
}
