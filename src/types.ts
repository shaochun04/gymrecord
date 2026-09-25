export type Unit = 'kg' | 'lb'

export const MUSCLE_GROUPS = ['chest', 'lats', 'upperBack', 'traps', 'frontDelts', 'sideDelts', 'rearDelts', 'biceps', 'triceps', 'forearms', 'quads', 'hamstrings', 'glutes', 'adductors', 'calves', 'core', 'lowerBack'] as const
export type MuscleGroup = typeof MUSCLE_GROUPS[number]

export type ExerciseDefinition = {
  id: string
  name: string
  equipment: string
  variation: string
  primaryMuscles: MuscleGroup[]
  secondaryMuscles: MuscleGroup[]
  archived: boolean
}

export type RoutineExercise = {
  id: string
  exerciseDefinitionId: string
  weight: number | null
  reps: number | null
  targetRepsMin: number | null
  targetRepsMax: number | null
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
  rir: 0 | 1 | 2 | 3 | 4 | null
  done: boolean
  kind: 'working' | 'warmup'
}

export type SessionExercise = {
  id: string
  sourceExerciseId: string
  exerciseDefinitionId: string
  name: string
  equipment: string
  variation: string
  note: string
  restSeconds: number
  targetRepsMin: number | null
  targetRepsMax: number | null
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
