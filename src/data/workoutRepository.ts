import type { AppSettings, Routine, WorkoutSession } from '../types'

export type WorkoutData = {
  routines: Routine[]
  sessions: WorkoutSession[]
  settings: AppSettings
}

// The UI uses this interface. Snapshots order routines by order and sessions newest first.
// Adapters notify subscribers after writes and restore all data atomically.
export interface WorkoutRepository {
  initialize(): Promise<void>
  subscribe(onChange: (data: WorkoutData) => void, onError: (error: unknown) => void): () => void
  getActiveSession(): Promise<WorkoutSession | null>
  saveRoutine(routine: Routine): Promise<void>
  deleteRoutine(id: string): Promise<void>
  saveSession(session: WorkoutSession): Promise<void>
  deleteSession(id: string): Promise<void>
  saveSettings(settings: AppSettings): Promise<void>
  readAll(): Promise<WorkoutData>
  replaceAll(data: WorkoutData): Promise<void>
}
