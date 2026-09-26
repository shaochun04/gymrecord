import type { ExerciseDefinition, Routine, WorkoutSession } from '../types'
import { createId } from '../id'
import { findPreviousPerformance } from '../workoutLogic'
import { normalizeExerciseText } from '../exerciseDefinitions'

export function makeSession(routine: Routine, definitions: ExerciseDefinition[], sessions: WorkoutSession[] = []): WorkoutSession {
  return {
    id: createId(),
    routineId: routine.id,
    routineName: routine.name,
    startedAt: new Date().toISOString(),
    endedAt: null,
    status: 'active',
    restEndsAt: null,
    exercises: routine.exercises.map((exercise) => {
      const definition = definitions.find((item) => item.id === exercise.exerciseDefinitionId)
      if (!definition) throw new Error('菜單引用的動作定義不存在')
      const equipment = normalizeExerciseText(exercise.defaultEquipment ?? '')
      const variation = normalizeExerciseText(exercise.defaultVariation ?? '')
      const previousSets = findPreviousPerformance({ exerciseDefinitionId: definition.id, equipment, variation }, sessions)?.sets ?? []
      return {
        id: createId(),
        sourceExerciseId: exercise.id,
        exerciseDefinitionId: definition.id,
        name: definition.name,
        equipment,
        variation,
        note: exercise.note,
        restSeconds: exercise.restSeconds,
        targetRepsMin: exercise.targetRepsMin,
        targetRepsMax: exercise.targetRepsMax,
        sets: Array.from({ length: exercise.sets }, (_, index) => {
          const previous = previousSets[index] ?? previousSets.at(-1)
          return {
            id: createId(),
            weight: previous ? previous.weight : exercise.weight,
            reps: previous ? previous.reps : exercise.reps,
            rir: null,
            done: false,
            kind: 'working' as const,
          }
        }),
      }
    }),
  }
}
