import { MUSCLE_GROUPS, type ExerciseDefinition, type MuscleGroup, type WorkoutSession } from './types'
import { localDateKey } from './utils'

export function startOfLocalWeek(value: Date) {
  const result = new Date(value.getFullYear(), value.getMonth(), value.getDate())
  result.setDate(result.getDate() - (result.getDay() + 6) % 7)
  return result
}

export function shiftLocalWeek(monday: Date, offset: number) {
  const shifted = new Date(monday)
  shifted.setDate(shifted.getDate() + 7 * offset)
  return shifted
}

export function weeklyMuscleStats(sessions: WorkoutSession[], definitions: ExerciseDefinition[], week: Date) {
  const start = startOfLocalWeek(week)
  const end = shiftLocalWeek(start, 1)
  const byId = new Map(definitions.map((definition) => [definition.id, definition]))
  const counts = new Map<MuscleGroup, { sets: number, days: Set<string> }>(MUSCLE_GROUPS.map((muscle) => [muscle, { sets: 0, days: new Set() }]))
  let unclassifiedSets = 0
  for (const session of sessions) {
    const time = new Date(session.startedAt).getTime()
    if (session.status !== 'completed' || time < start.getTime() || time >= end.getTime()) continue
    const day = localDateKey(session.startedAt)
    for (const exercise of session.exercises) {
      const count = exercise.sets.filter((set) => set.done && set.kind === 'working').length
      if (count === 0) continue
      const primary = byId.get(exercise.exerciseDefinitionId)?.primaryMuscles ?? []
      if (primary.length === 0) unclassifiedSets += count
      for (const muscle of primary) {
        const entry = counts.get(muscle)!
        entry.sets += count
        entry.days.add(day)
      }
    }
  }
  return {
    weekStart: start,
    unclassifiedSets,
    muscles: MUSCLE_GROUPS.map((muscle) => ({ muscle, sets: counts.get(muscle)!.sets, days: counts.get(muscle)!.days.size })),
  }
}
