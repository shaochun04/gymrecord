import type { AppSettings, Routine, WorkoutSession } from '../types'

export type WorkoutChange =
  | { kind: 'routines', value: Routine[] }
  | { kind: 'sessions', value: WorkoutSession[] }
  | { kind: 'settings', value: AppSettings }

// A change source emits each collection initially and after committed writes.
// Callbacks are asynchronous and may fire after a write promise resolves.
// Unsubscribe stops future callbacks; errors are sent to onError.
// Native adapters can emit these changes after their own writes without liveQuery.
export interface WorkoutChangeSource {
  subscribe(onChange: (change: WorkoutChange) => void, onError: (error: unknown) => void): () => void
}
