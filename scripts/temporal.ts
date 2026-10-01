// Electron and Node have Temporal; Bun, which runs the scripts and unit tests,
// doesn't yet. This gives it the polyfill, and does nothing where it's native.

if (!('Temporal' in globalThis)) await import('temporal-polyfill/global')
