import type { AppSettings, ExerciseDefinition, MuscleGroup, Routine, RoutineExercise, SessionExercise, SetLog, WorkoutSession } from '../types'
import { createId } from '../id'
import { legacyExerciseKey, normalizeExerciseOptions, normalizeExerciseText } from '../exerciseDefinitions'

export type RoutineExerciseV2 = Omit<RoutineExercise, 'exerciseDefinitionId' | 'defaultEquipment' | 'defaultVariation'> & { name: string, equipment: string }
export type RoutineV2 = Omit<Routine, 'exercises'> & { exercises: RoutineExerciseV2[] }
export type SessionExerciseV2 = Omit<SessionExercise, 'exerciseDefinitionId' | 'variation'>
export type WorkoutSessionV2 = Omit<WorkoutSession, 'exercises'> & { exercises: SessionExerciseV2[] }
export type RoutineExerciseV1 = Omit<RoutineExerciseV2, 'targetRepsMin' | 'targetRepsMax'>
export type RoutineV1 = Omit<RoutineV2, 'exercises'> & { exercises: RoutineExerciseV1[] }
export type SetLogV1 = Omit<SetLog, 'rir'>
export type SessionExerciseV1 = Omit<SessionExerciseV2, 'targetRepsMin' | 'targetRepsMax' | 'sets'> & { sets: SetLogV1[] }
export type WorkoutSessionV1 = Omit<WorkoutSessionV2, 'exercises'> & { exercises: SessionExerciseV1[] }

export type ExerciseDefinitionV3 = Omit<ExerciseDefinition, 'equipmentOptions' | 'variationOptions'> & { equipment: string, variation: string }
export type RoutineExerciseV3 = Omit<RoutineExercise, 'defaultEquipment' | 'defaultVariation'>
export type RoutineV3 = Omit<Routine, 'exercises'> & { exercises: RoutineExerciseV3[] }
export type SessionExerciseV3 = SessionExercise
export type WorkoutSessionV3 = WorkoutSession
export type WorkoutDataV2 = { routines: RoutineV2[], sessions: WorkoutSessionV2[], settings: AppSettings }
export type WorkoutDataV3 = { exerciseDefinitions: ExerciseDefinitionV3[], routines: RoutineV3[], sessions: WorkoutSessionV3[], settings: AppSettings }
export type WorkoutDataV4 = { exerciseDefinitions: ExerciseDefinition[], routines: Routine[], sessions: WorkoutSession[], settings: AppSettings }

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
  const definitionsByKey = new Map<string, ExerciseDefinitionV3>()
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
  const routines = data.routines.map((routine): RoutineV3 => ({ ...routine, exercises: routine.exercises.map((exercise) => {
    const { name, equipment, ...slot } = exercise
    const definition = resolve(name, equipment)
    referencedByRoutine.add(definition.id)
    return { ...slot, exerciseDefinitionId: definition.id }
  }) }))
  const sessions = data.sessions.map((session): WorkoutSessionV3 => ({ ...session, exercises: session.exercises.map((exercise) => ({
    ...exercise, exerciseDefinitionId: resolve(exercise.name, exercise.equipment).id, variation: '',
  })) }))
  const exerciseDefinitions = [...definitionsByKey.values()].map((definition) => ({
    ...definition, archived: !referencedByRoutine.has(definition.id),
  }))
  return { exerciseDefinitions, routines, sessions }
}

function commonMuscles(definitions: ExerciseDefinitionV3[], field: 'primaryMuscles' | 'secondaryMuscles'): MuscleGroup[] {
  const [first, ...rest] = definitions
  if (!first) return []
  return first[field].filter((muscle) => rest.every((definition) => definition[field].includes(muscle)))
}

// v3 stored one definition per name/equipment/variation. v4 groups exact normalized
// names only. A canonical old ID is retained and every old reference is remapped.
// Conflicting muscle classifications are resolved conservatively by intersection:
// only classifications shared by every grouped definition survive automatically.
export function migrateWorkoutDataV3(data: Pick<WorkoutDataV3, 'exerciseDefinitions' | 'routines' | 'sessions'>): Omit<WorkoutDataV4, 'settings'> {
  const grouped = new Map<string, ExerciseDefinitionV3[]>()
  for (const definition of data.exerciseDefinitions) {
    const key = normalizeExerciseText(definition.name).toLocaleLowerCase()
    grouped.set(key, [...(grouped.get(key) ?? []), definition])
  }

  const remap = new Map<string, string>()
  const exerciseDefinitions: ExerciseDefinition[] = []
  for (const definitions of grouped.values()) {
    const canonical = definitions.find((definition) => !definition.archived) ?? definitions[0]
    definitions.forEach((definition) => remap.set(definition.id, canonical.id))
    const primaryMuscles = commonMuscles(definitions, 'primaryMuscles')
    const secondaryMuscles = commonMuscles(definitions, 'secondaryMuscles')
      .filter((muscle) => !primaryMuscles.includes(muscle))
    exerciseDefinitions.push({
      id: canonical.id,
      name: normalizeExerciseText(canonical.name),
      equipmentOptions: normalizeExerciseOptions(definitions.map((definition) => definition.equipment)),
      variationOptions: normalizeExerciseOptions(definitions.map((definition) => definition.variation)),
      primaryMuscles,
      secondaryMuscles,
      archived: definitions.every((definition) => definition.archived),
    })
  }

  const byOldId = new Map(data.exerciseDefinitions.map((definition) => [definition.id, definition]))
  const routines: Routine[] = data.routines.map((routine) => ({ ...routine, exercises: routine.exercises.map((exercise) => {
    const definition = byOldId.get(exercise.exerciseDefinitionId)
    if (!definition) throw new Error('v3 菜單引用的動作定義不存在')
    return {
      ...exercise,
      exerciseDefinitionId: remap.get(exercise.exerciseDefinitionId)!,
      defaultEquipment: normalizeExerciseText(definition.equipment) || null,
      defaultVariation: normalizeExerciseText(definition.variation) || null,
    }
  }) }))
  const sessions: WorkoutSession[] = data.sessions.map((session) => ({ ...session, exercises: session.exercises.map((exercise) => {
    if (!remap.has(exercise.exerciseDefinitionId)) throw new Error('v3 訓練引用的動作定義不存在')
    return { ...exercise, exerciseDefinitionId: remap.get(exercise.exerciseDefinitionId)! }
  }) }))
  return { exerciseDefinitions, routines, sessions }
}
