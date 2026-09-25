import type { Routine, WorkoutSession } from '../types'
import { createId } from '../id'
import { findPreviousPerformance } from '../workoutLogic'

export function makeSession(routine: Routine, sessions: WorkoutSession[] = []): WorkoutSession {
  return {
    id: createId(),
    routineId: routine.id,
    routineName: routine.name,
    startedAt: new Date().toISOString(),
    endedAt: null,
    status: 'active',
    restEndsAt: null,
    exercises: routine.exercises.map((exercise) => {
      const previousSets = findPreviousPerformance({
        sourceExerciseId: exercise.id, name: exercise.name, equipment: exercise.equipment,
      }, sessions, undefined, routine.id)?.sets ?? []
      return {
        id: createId(),
        sourceExerciseId: exercise.id,
        name: exercise.name,
        equipment: exercise.equipment,
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
