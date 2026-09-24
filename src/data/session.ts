import type { Routine, WorkoutSession } from '../types'
import { createId } from '../id'

export function makeSession(routine: Routine, previous?: WorkoutSession): WorkoutSession {
  return {
    id: createId(),
    routineId: routine.id,
    routineName: routine.name,
    startedAt: new Date().toISOString(),
    endedAt: null,
    status: 'active',
    restEndsAt: null,
    exercises: routine.exercises.map((exercise) => {
      const previousExercise = previous?.exercises.find(
        (item) => item.sourceExerciseId === exercise.id ||
          (item.name === exercise.name && item.equipment === exercise.equipment),
      )
      const previousSets = previousExercise?.sets.filter((set) => set.kind === 'working' && set.done) ?? []
      return {
        id: createId(),
        sourceExerciseId: exercise.id,
        name: exercise.name,
        equipment: exercise.equipment,
        note: exercise.note,
        restSeconds: exercise.restSeconds,
        sets: Array.from({ length: exercise.sets }, (_, index) => ({
          id: createId(),
          weight: previousSets[index]?.weight ?? previousSets.at(-1)?.weight ?? exercise.weight,
          reps: previousSets[index]?.reps ?? previousSets.at(-1)?.reps ?? exercise.reps,
          done: false,
          kind: 'working' as const,
        })),
      }
    }),
  }
}
