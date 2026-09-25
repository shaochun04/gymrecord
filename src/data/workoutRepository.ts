import type { AppSettings, ExerciseDefinition, Routine, WorkoutSession } from '../types'

export type WorkoutData = {
  exerciseDefinitions: ExerciseDefinition[]
  routines: Routine[]
  sessions: WorkoutSession[]
  settings: AppSettings
}

export class MultipleActiveSessionsError extends Error {
  constructor() { super('偵測到多筆進行中的訓練，請先匯出備份並檢查資料') }
}

export class ActiveSessionExistsError extends Error {
  constructor(readonly activeSession: WorkoutSession) {
    super('已有進行中的訓練')
  }
}

// Storage contract shared by web and future native adapters:
// - Routines are ordered by order; sessions by startedAt, newest first.
// - Settings always exists and has id === 'main' after initialize().
// - Exercise definitions keep stable IDs and are archived rather than deleted.
//   Existing routine and session references remain readable after archival.
// - At most one session may have status === 'active'. saveSession() enforces this
//   atomically, and getActiveSession() reports an existing violation.
// - A completed session may be corrected, but saveSession() never reactivates it.
// - replaceAll() is one atomic operation: every write commits or none do.
// - mergeExerciseDefinitions() updates all routine and session references and
//   archives the source in one transaction; session display snapshots remain.
// - Every successful write is emitted asynchronously by the separate change
//   source after commit; failed writes emit no committed value.
export interface WorkoutRepository {
  initialize(): Promise<void>
  getExerciseDefinitions(): Promise<ExerciseDefinition[]>
  saveExerciseDefinition(definition: ExerciseDefinition): Promise<void>
  archiveExerciseDefinition(id: string, archived: boolean): Promise<void>
  mergeExerciseDefinitions(sourceId: string, targetId: string): Promise<{ routines: number, sessions: number }>
  getRoutines(): Promise<Routine[]>
  getSessions(): Promise<WorkoutSession[]>
  getSession(id: string): Promise<WorkoutSession | null>
  getSessionsByDateRange(fromInclusive: string, toExclusive: string): Promise<WorkoutSession[]> // ISO instants.
  getSettings(): Promise<AppSettings>
  getActiveSession(): Promise<WorkoutSession | null>
  saveRoutine(routine: Routine): Promise<void>
  deleteRoutine(id: string): Promise<void>
  saveSession(session: WorkoutSession): Promise<void>
  deleteSession(id: string): Promise<void>
  saveSettings(settings: AppSettings): Promise<void>
  readAll(): Promise<WorkoutData> // Consistent full snapshot for backup only.
  replaceAll(data: WorkoutData): Promise<void>
}
