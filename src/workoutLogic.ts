import type { SessionExercise, SetLog, Unit, WorkoutSession } from './types'
import { displayWeight, weightToKg } from './utils'

export function findPreviousPerformance(exercise: SessionExercise, sessions: WorkoutSession[], currentSessionId?: string) {
  const completed = sessions
    .filter((session) => session.status === 'completed' && session.id !== currentSessionId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  const sourceId = exercise.sourceExerciseId
  for (const session of completed) {
    const hasWorkingLog = (item: SessionExercise) => item.sets.some((set) => set.done && set.kind === 'working')
    const byId = sourceId && session.exercises.find((item) => item.sourceExerciseId === sourceId && hasWorkingLog(item))
    const candidate = byId || session.exercises.find((item) =>
      (!sourceId || !item.sourceExerciseId) &&
      item.name === exercise.name && item.equipment === exercise.equipment && hasWorkingLog(item),
    )
    if (candidate) return {
      date: session.startedAt,
      sets: candidate.sets.filter((set) => set.done && set.kind === 'working').map((set) => ({ ...set })),
    }
  }
  return null
}

export function nextRestEndAfterToggle(set: SetLog, enabled: boolean, restSeconds: number, now: number, currentEnd: number | null) {
  // Warmup and working sets currently use the same rule; change it here if needed.
  const startsRest = set.kind === 'working' || set.kind === 'warmup'
  if (set.done || !enabled || !startsRest) return currentEnd
  return restSeconds > 0 ? now + restSeconds * 1000 : null
}

export function remainingRestSeconds(restEndsAt: number | null, now: number) {
  return restEndsAt === null ? 0 : Math.max(0, Math.ceil((restEndsAt - now) / 1000))
}

export function shiftRestEnd(restEndsAt: number | null, seconds: number, now: number) {
  if (restEndsAt === null) return null
  const shifted = restEndsAt + seconds * 1000
  return shifted > now ? shifted : null
}

export function adjustWeightKg(weightKg: number | null, unit: Unit, direction: -1 | 1) {
  const shown = Number(displayWeight(weightKg, unit)) || 0
  const next = Math.max(0, Math.round((shown + direction) * 10) / 10)
  return weightToKg(next, unit)
}

export function adjustReps(reps: number | null, direction: -1 | 1) {
  return Math.max(0, (reps ?? 0) + direction)
}

export function durationMinutes(startedAt: string, endedAt: string | number) {
  const end = typeof endedAt === 'number' ? endedAt : new Date(endedAt).getTime()
  return Math.max(0, Math.floor((end - new Date(startedAt).getTime()) / 60000))
}

export function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return hours > 0 ? `${hours} 小時 ${String(rest).padStart(2, '0')} 分` : `${rest} 分`
}

export function completedWorkingVolumeKg(session: WorkoutSession) {
  return session.exercises.reduce((total, exercise) => total + exercise.sets.reduce((sum, set) =>
    sum + (set.done && set.kind === 'working' ? (set.weight ?? 0) * (set.reps ?? 0) : 0), 0), 0)
}
