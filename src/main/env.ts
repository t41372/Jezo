// Runs before anything else in the main process, because pi reads some of these
// when it loads (docs/design/backend.md, "Isolation"). index.ts imports it and
// only then loads the app, with a dynamic import: a bundle runs every static
// import of an outside package before any of its own code.

import { join } from 'node:path'
import { app } from 'electron'

// Tests run the app with data of their own.
if (process.env.JEZO_USER_DATA) app.setPath('userData', process.env.JEZO_USER_DATA)

// Jezo's agent keeps its own pi directory, so it never reads the user's own pi settings, keys or skills.
process.env.PI_CODING_AGENT_DIR = join(app.getPath('userData'), 'pi')
// No model catalog refresh, no downloads of rg and fd, no telemetry: nothing the user didn't ask for.
process.env.PI_OFFLINE = '1'
process.env.PI_TELEMETRY = '0'
