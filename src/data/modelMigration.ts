import type { AppSettings, ExerciseDefinition, Routine, RoutineExercise, SessionExercise, SetLog, WorkoutSession } from '../types'
import { createId } from '../id'
import { legacyExerciseKey, normalizeExerciseText } from '../exerciseDefinitions'

export type RoutineExerciseV2 = Omit<RoutineExercise, 'exerciseDefinitionId'> & { name: string, equipment: string }
export type RoutineV2 = Omit<Routine, 'exercises'> & { exercises: RoutineExerciseV2[] }
export type SessionExerciseV2 = Omit<SessionExercise, 'exerciseDefinitionId' | 'variation'>
export type WorkoutSessionV2 = Omit<WorkoutSession, 'exercises'> & { exercises: SessionExerciseV2[] }
export type RoutineExerciseV1 = Omit<RoutineExerciseV2, 'targetRepsMin' | 'targetRepsMax'>
export type RoutineV1 = Omit<RoutineV2, 'exercises'> & { exercises: RoutineExerciseV1[] }
export type SetLogV1 = Omit<SetLog, 'rir'>
export type SessionExerciseV1 = Omit<SessionExerciseV2, 'targetRepsMin' | 'targetRepsMax' | 'sets'> & { sets: SetLogV1[] }
export type WorkoutSessionV1 = Omit<WorkoutSessionV2, 'exercises'> & { exercises: SessionExerciseV1[] }

export type WorkoutDataV2 = { routines: RoutineV2[], sessions: WorkoutSessionV2[], settings: AppSettings }
export type WorkoutDataV3 = { exerciseDefinitions: ExerciseDefinition[], routines: Routine[], sessions: WorkoutSession[], settings: AppSettings }

export function migrateRoutineV1(routine: RoutineV1): RoutineV2 {
  return { ...routine, exercises: routine.exercises.map((exercise) => ({
    ...exercise, targetRepsMin: exercise.reps, targetRepsMax: exercise.reps,
  })) }
}

export function migrateSessionV1(session: WorkoutSessionV1): WorkoutSessionV2 {
  return { ...session, exercises: session.exercises.map((exercise) => ({
    ...exercise, targetRepsMin: null, targetRepsMax: null,
    sets: exercise.sets.map((set) => ({ ...set, rir: null })),
  })) }
}

// Exact normalized name + equipment is the only automatic identity rule for legacy data.
export function migrateWorkoutDataV2(data: Pick<WorkoutDataV2, 'routines' | 'sessions'>): Omit<WorkoutDataV3, 'settings'> {
  const definitionsByKey = new Map<string, ExerciseDefinition>()
  const referencedByRoutine = new Set<string>()
  function resolve(name: string, equipment: string) {
    const key = legacyExerciseKey(name, equipment)
    let definition = definitionsByKey.get(key)
    if (!definition) {
      definition = {
        id: createId(), name: normalizeExerciseText(name), equipment: normalizeExerciseText(equipment),
        variation: '', primaryMuscles: [], secondaryMuscles: [], archived: false,
      }
      definitionsByKey.set(key, definition)
    }
    return definition
  }
  const routines = data.routines.map((routine): Routine => ({ ...routine, exercises: routine.exercises.map((exercise) => {
    const { name, equipment, ...slot } = exercise
    const definition = resolve(name, equipment)
    referencedByRoutine.add(definition.id)
    return { ...slot, exerciseDefinitionId: definition.id }
  }) }))
  const sessions = data.sessions.map((session): WorkoutSession => ({ ...session, exercises: session.exercises.map((exercise) => ({
    ...exercise, exerciseDefinitionId: resolve(exercise.name, exercise.equipment).id, variation: '',
  })) }))
  const exerciseDefinitions = [...definitionsByKey.values()].map((definition) => ({
    ...definition, archived: !referencedByRoutine.has(definition.id),
  }))
  return { exerciseDefinitions, routines, sessions }
}
