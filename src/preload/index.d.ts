import type { JezoBridge } from '../shared/bridge'

declare global {
  interface Window {
    jezo: JezoBridge
  }
}
