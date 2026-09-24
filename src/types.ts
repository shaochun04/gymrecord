export type Unit = 'kg' | 'lb'

export type RoutineExercise = {
  id: string
  name: string
  equipment: string
  weight: number | null
  reps: number | null
  sets: number
  restSeconds: number
  note: string
}

export type Routine = {
  id: string
  name: string
  label: string
  accent: string
  order: number
  exercises: RoutineExercise[]
  updatedAt: string
}

export type SetLog = {
  id: string
  weight: number | null
  reps: number | null
  done: boolean
  kind: 'working' | 'warmup'
}

export type SessionExercise = {
  id: string
  sourceExerciseId: string
  name: string
  equipment: string
  note: string
  restSeconds: number
  sets: SetLog[]
}

export type WorkoutSession = {
  id: string
  routineId: string | null
  routineName: string
  startedAt: string
  endedAt: string | null
  status: 'active' | 'completed'
  restEndsAt: number | null
  exercises: SessionExercise[]
}

export type AppSettings = {
  id: 'main'
  unit: Unit
  restTimerEnabled: boolean
}
