/**
 * Registers a global hotkey such as "Alt+X", replacing any registered before.
 * The listener hears "down" when it's pressed and "up" when it's released.
 * Throws with the reason when the OS refuses it.
 */
export function register(accelerator: string, listener: (state: 'down' | 'up') => void): void
export function unregister(): void
