import type { SessionExercise, SetLog, Unit, WorkoutSession } from './types'
import { displayWeight, weightToKg } from './utils'

export type ExerciseReference = Pick<SessionExercise, 'sourceExerciseId' | 'name' | 'equipment'>

function matchingExercise(reference: ExerciseReference, session: WorkoutSession, currentRoutineId: string | null) {
  const byId = reference.sourceExerciseId && session.exercises.find((item) => item.sourceExerciseId === reference.sourceExerciseId)
  if (byId) return byId
  // Source IDs belong to routine exercises. Across routines, the same movement has a different ID.
  const allowNameMatch = !reference.sourceExerciseId || session.routineId !== currentRoutineId
  return session.exercises.find((item) =>
    (allowNameMatch || !item.sourceExerciseId) &&
    item.name === reference.name && item.equipment === reference.equipment,
  )
}

export function findExerciseHistory(reference: ExerciseReference, sessions: WorkoutSession[], currentRoutineId: string | null, currentSessionId?: string) {
  return sessions
    .filter((session) => session.status === 'completed' && session.id !== currentSessionId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .flatMap((session) => {
      const match = matchingExercise(reference, session, currentRoutineId)
      const sets = match?.sets.filter((set) => set.done).map((set) => ({ ...set })) ?? []
      return sets.length ? [{ sessionId: session.id, date: session.startedAt, routineName: session.routineName, sets }] : []
    })
}

export function findPreviousPerformance(reference: ExerciseReference, sessions: WorkoutSession[], currentSessionId?: string, currentRoutineId: string | null = null) {
  const previous = findExerciseHistory(reference, sessions, currentRoutineId, currentSessionId)
    .find((entry) => entry.sets.some((set) => set.kind === 'working'))
  return previous ? { date: previous.date, sets: previous.sets.filter((set) => set.kind === 'working') } : null
}

export function calculateExercisePr(history: ReturnType<typeof findExerciseHistory>) {
  const eligible = history.flatMap((entry) => entry.sets.filter((set) =>
    set.kind === 'working' && set.weight !== null && set.weight > 0 && set.reps !== null && set.reps > 0,
  ))
  const weightPr = eligible.reduce<SetLog | null>((best, set) =>
    !best || set.weight! > best.weight! || (set.weight === best.weight && set.reps! > best.reps!) ? set : best, null)
  const estimatedOneRepMaxPr = eligible.reduce<{ set: SetLog, estimateKg: number } | null>((best, set) => {
    const estimateKg = set.weight! * (1 + set.reps! / 30)
    return !best || estimateKg > best.estimateKg ? { set, estimateKg } : best
  }, null)
  const byWeight = new Map<number, SetLog>()
  for (const set of eligible) {
    const best = byWeight.get(set.weight!)
    if (!best || set.reps! > best.reps!) byWeight.set(set.weight!, set)
  }
  const repsPrByWeight = [...byWeight.entries()]
    .sort(([a], [b]) => b - a)
    .map(([weightKg, set]) => ({ weightKg, reps: set.reps! }))
  return { weightPr, estimatedOneRepMaxPr, repsPrByWeight }
}

export function formatRir(rir: SetLog['rir']) {
  return rir === null ? '' : `RIR ${rir === 4 ? '4+' : rir}`
}

export function getProgressionSuggestion(targetRepsMin: number | null, targetRepsMax: number | null, sets: SetLog[]) {
  const none = { kind: 'none' as const, text: '' }
  if (targetRepsMin === null || targetRepsMax === null || targetRepsMin < 1 || targetRepsMax < targetRepsMin) return none
  const working = sets.filter((set) => set.done && set.kind === 'working')
  if (working.length === 0 || working.some((set) => set.reps === null || set.reps <= 0)) return none
  if (working.every((set) => set.reps! >= targetRepsMax)) {
    return working.some((set) => set.rir === 0)
      ? { kind: 'hold-limit' as const, text: '已達次數上限，但接近力竭，可先維持重量' }
      : { kind: 'increase' as const, text: '已達目標次數上限，下次可考慮增加重量' }
  }
  if (working.some((set) => set.reps! < targetRepsMin)) {
    return { kind: 'below-range' as const, text: '部分組數低於目標範圍，可先維持重量；若持續無法達標再考慮降低重量' }
  }
  return { kind: 'add-reps' as const, text: '維持目前重量，優先增加次數' }
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
