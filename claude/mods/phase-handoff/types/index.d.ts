export type Handoff = {
  prompt: string
  reason: string
  /** Seconds until the fresh session starts; null while the turn is still running. */
  secondsLeft: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'phase-handoff': { pending: Handoff | null }
  }
}
