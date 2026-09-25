import type { Routine, RoutineExercise, SessionExercise, SetLog, WorkoutSession } from '../types'

export type RoutineExerciseV1 = Omit<RoutineExercise, 'targetRepsMin' | 'targetRepsMax'>
export type RoutineV1 = Omit<Routine, 'exercises'> & { exercises: RoutineExerciseV1[] }
export type SetLogV1 = Omit<SetLog, 'rir'>
export type SessionExerciseV1 = Omit<SessionExercise, 'targetRepsMin' | 'targetRepsMax' | 'sets'> & { sets: SetLogV1[] }
export type WorkoutSessionV1 = Omit<WorkoutSession, 'exercises'> & { exercises: SessionExerciseV1[] }

export function migrateRoutineV1(routine: RoutineV1): Routine {
  return {
    ...routine,
    exercises: routine.exercises.map((exercise) => ({
      ...exercise,
      targetRepsMin: exercise.reps,
      targetRepsMax: exercise.reps,
    })),
  }
}

export function migrateSessionV1(session: WorkoutSessionV1): WorkoutSession {
  return {
    ...session,
    exercises: session.exercises.map((exercise) => ({
      ...exercise,
      targetRepsMin: null,
      targetRepsMax: null,
      sets: exercise.sets.map((set) => ({ ...set, rir: null })),
    })),
  }
}
