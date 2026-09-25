import { describe, expect, it } from 'vitest'
import type { ExerciseDefinition, SetLog, WorkoutSession } from '../src/types'
import { shiftLocalWeek, startOfLocalWeek, weeklyMuscleStats } from '../src/muscleStats'

const definitions: ExerciseDefinition[] = [
  { id: 'bench', name: '臥推', equipment: '啞鈴', variation: '', primaryMuscles: ['chest'], secondaryMuscles: ['triceps'], archived: false },
  { id: 'squat', name: '深蹲', equipment: '槓鈴', variation: '', primaryMuscles: ['quads', 'glutes'], secondaryMuscles: ['lowerBack'], archived: false },
  { id: 'unknown', name: '自訂', equipment: '', variation: '', primaryMuscles: [], secondaryMuscles: [], archived: true },
]
function row(id: string, done = true, kind: SetLog['kind'] = 'working'): SetLog {
  return { id, weight: 20, reps: 10, rir: null, done, kind }
}
function record(id: string, date: Date, definitionId: string, sets: SetLog[], status: WorkoutSession['status'] = 'completed'): WorkoutSession {
  return { id, routineId: 'r', routineName: 'Routine', startedAt: date.toISOString(), endedAt: status === 'completed' ? date.toISOString() : null,
    status, restEndsAt: null, exercises: [{ id: `e-${id}`, sourceExerciseId: `slot-${id}`, exerciseDefinitionId: definitionId,
      name: 'snapshot', equipment: '', variation: '', note: '', restSeconds: 90, targetRepsMin: null, targetRepsMax: null, sets }] }
}

describe('weekly primary muscle sets', () => {
  it('uses local Monday 00:00 through next Monday exclusive', () => {
    const monday = new Date(2026, 8, 21, 0, 0)
    expect(startOfLocalWeek(new Date(2026, 8, 27, 23, 59)).getTime()).toBe(monday.getTime())
    expect(shiftLocalWeek(monday, 1).getTime()).toBe(new Date(2026, 8, 28, 0, 0).getTime())
    const sessions = [
      record('before', new Date(2026, 8, 20, 23, 59), 'bench', [row('b')]),
      record('start', monday, 'bench', [row('s')]),
      record('end', new Date(2026, 8, 27, 23, 59), 'bench', [row('e')]),
      record('next', new Date(2026, 8, 28, 0, 0), 'bench', [row('n')]),
    ]
    const stats = weeklyMuscleStats(sessions, definitions, monday)
    expect(stats.muscles.find((item) => item.muscle === 'chest')).toMatchObject({ sets: 2, days: 2 })
  })

  it('counts completed done working only, primary only, with multiple primary groups and distinct exposure days', () => {
    const monday = new Date(2026, 8, 21)
    const sessions = [
      record('bench1', new Date(2026, 8, 21, 10), 'bench', [row('a'), row('b'), row('warm', true, 'warmup'), row('undone', false)]),
      record('bench2', new Date(2026, 8, 21, 18), 'bench', [row('c')]),
      record('bench3', new Date(2026, 8, 24, 10), 'bench', [row('d')]),
      record('active', new Date(2026, 8, 24, 12), 'bench', [row('active')], 'active'),
      record('squat', new Date(2026, 8, 22, 10), 'squat', [row('q1'), row('q2'), row('qWarm', true, 'warmup')]),
      record('unknown', new Date(2026, 8, 22, 12), 'unknown', [row('u1'), row('u2'), row('u3', false)]),
    ]
    const stats = weeklyMuscleStats(sessions, definitions, monday)
    expect(stats.muscles.find((item) => item.muscle === 'chest')).toMatchObject({ sets: 4, days: 2 })
    expect(stats.muscles.find((item) => item.muscle === 'triceps')).toMatchObject({ sets: 0, days: 0 })
    expect(stats.muscles.find((item) => item.muscle === 'quads')).toMatchObject({ sets: 2, days: 1 })
    expect(stats.muscles.find((item) => item.muscle === 'glutes')).toMatchObject({ sets: 2, days: 1 })
    expect(stats.muscles.find((item) => item.muscle === 'lowerBack')).toMatchObject({ sets: 0, days: 0 })
    expect(stats.unclassifiedSets).toBe(2)
    expect(stats.unclassifiedExercises).toEqual([{ exerciseDefinitionId: 'unknown', sets: 2 }])
    const corrected = definitions.map((item) => item.id === 'unknown' ? { ...item, primaryMuscles: ['upperBack' as const] } : item)
    expect(weeklyMuscleStats(sessions, corrected, monday).muscles.find((item) => item.muscle === 'upperBack')?.sets).toBe(2)
  })
})
