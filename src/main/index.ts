// The main process's entry. The environment has to be set before pi loads, so
// the rest of the app is imported only after env.ts has run.

import './env'

await import('./app')
