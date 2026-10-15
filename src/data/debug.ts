// Shared debug logging utility
// Enable via: DEBUG=claude-hud or DEBUG=*

/**
 * `process.env`, or an empty object where there is no `process`: the statusline's widgets also run
 * inside a Claude Code mod (hooks/register.tsx), whose sandbox has no Node globals. A bare
 * `process.env` there throws a ReferenceError when the module loads.
 */
export const safeEnv = (): NodeJS.ProcessEnv => (typeof process === "undefined" ? {} : process.env);

const DEBUG = safeEnv().DEBUG?.includes("claude-hud") || safeEnv().DEBUG === "*";

/**
 * Create a namespaced debug logger
 * @param namespace - Tag for log messages (e.g., 'config', 'usage')
 */
export function createDebug(namespace: string) {
  return function debug(msg: string, ...args: unknown[]): void {
    if (DEBUG) {
      console.error(`[claude-hud:${namespace}] ${msg}`, ...args);
    }
  };
}
