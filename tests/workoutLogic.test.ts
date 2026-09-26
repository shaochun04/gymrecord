import { describe, expect, it } from 'vitest'
import type { ExerciseDefinition, Routine, SessionExercise, SetLog, WorkoutSession } from '../src/types'
import { makeSession } from '../src/data/session'
import { serializeCsv } from '../src/data/backup'
import { displayWeight } from '../src/utils'
import { formatTargetRange, normalizeTargetRange } from '../src/targetReps'
import {
  adjustReps, adjustWeightKg, calculateExercisePr, completedWorkingVolumeKg, durationMinutes,
  findExerciseHistory, findPreviousPerformance, getProgressionSuggestion,
  formatDuration, nextRestEndAfterToggle, remainingRestSeconds, shiftRestEnd,
} from '../src/workoutLogic'

const bench: ExerciseDefinition = { id: 'bench', name: '臥推', equipmentOptions: ['啞鈴', '槓鈴', '史密斯'], variationOptions: ['平板', '上斜'], primaryMuscles: ['chest'], secondaryMuscles: ['triceps'], archived: false }
const set = (id: string, weight: number | null, reps: number | null, done = true, kind: SetLog['kind'] = 'working', rir: SetLog['rir'] = null): SetLog =>
  ({ id, weight, reps, rir, done, kind })
const exercise = (id: string, definitionId: string, sets: SetLog[], name = '臥推', equipment = '啞鈴', variation = '平板'): SessionExercise =>
  ({ id, sourceExerciseId: `slot-${id}`, exerciseDefinitionId: definitionId, name, equipment, variation, note: '椅背 30°', restSeconds: 90, targetRepsMin: 8, targetRepsMax: 12, sets })
const identity = (equipment = '啞鈴', variation = '平板') => ({ exerciseDefinitionId: bench.id, equipment, variation })
const session = (id: string, startedAt: string, exercises: SessionExercise[], status: WorkoutSession['status'] = 'completed'): WorkoutSession =>
  ({ id, routineId: id, routineName: id, startedAt, endedAt: status === 'completed' ? startedAt : null, status, restEndsAt: null, exercises })

describe('global exercise identity and history', () => {
  const older = session('push', '2026-09-20T10:00:00Z', [exercise('push-slot', bench.id, [set('old', 20, 10)])])
  const newer = session('upper', '2026-09-25T10:00:00Z', [exercise('upper-slot', bench.id, [set('a', 22, 10), set('b', 22, 9, true, 'working', 2), set('warm', 10, 12, true, 'warmup'), set('undone', 30, 5, false)])])

  it('shares latest completed working sets across Push and Upper by definition ID', () => {
    const active = session('active', '2026-09-26T10:00:00Z', [exercise('active', bench.id, [set('active-set', 30, 8)])], 'active')
    expect(findPreviousPerformance(identity(), [older, active, newer])?.sets.map((row) => row.id)).toEqual(['a', 'b'])
    const history = findExerciseHistory(identity(), [older, active, newer])
    expect(history.map((row) => row.sessionId)).toEqual(['upper', 'push'])
    expect(history[0].sets.map((row) => [row.id, row.rir])).toEqual([['a', null], ['b', 2], ['warm', null]])
  })

  it('does not combine barbell, dumbbell, and Smith even with the same display name', () => {
    const mixed = session('mixed', '2026-09-26T10:00:00Z', [
      exercise('barbell', bench.id, [set('barbell', 80, 5)], '臥推', '槓鈴'),
      exercise('smith', bench.id, [set('smith', 90, 5)], '臥推', '史密斯'),
      exercise('dumbbell', bench.id, [set('dumbbell', 22, 10)]),
    ])
    expect(calculateExercisePr(findExerciseHistory(identity(), [mixed])).weightPr?.id).toBe('dumbbell')
    expect(calculateExercisePr(findExerciseHistory(identity('槓鈴'), [mixed])).weightPr?.id).toBe('barbell')
    expect(calculateExercisePr(findExerciseHistory(identity('史密斯'), [mixed])).weightPr?.id).toBe('smith')
  })

  it('keeps different variations separate even when name and equipment match', () => {
    const mixed = session('mixed', '2026-09-26T10:00:00Z', [
      exercise('flat', bench.id, [set('flat-set', 22, 10)]),
      exercise('incline', bench.id, [set('incline-set', 18, 10)], '臥推', '啞鈴', '上斜'),
    ])
    expect(findPreviousPerformance(identity(), [mixed])?.sets[0].id).toBe('flat-set')
    expect(findPreviousPerformance(identity('啞鈴', '上斜'), [mixed])?.sets[0].id).toBe('incline-set')
  })

  it('keeps archived definitions queryable and history copies isolated', () => {
    const archived = { ...bench, archived: true }
    const previous = findPreviousPerformance(identity(), [older])!
    previous.sets[0].weight = 99
    expect(older.exercises[0].sets[0].weight).toBe(20)
    expect(findPreviousPerformance(identity(), [older])?.sets[0].weight).toBe(20)
  })

  it('prefills each set from latest global history, snapshots definition and targets, and never copies RIR', () => {
    const routine: Routine = { id: 'push', name: 'Push', label: '', accent: '#fff', order: 0, updatedAt: '2026-09-01T00:00:00Z',
      exercises: [{ id: 'push-slot', exerciseDefinitionId: bench.id, defaultEquipment: '啞鈴', defaultVariation: '平板', weight: 15, reps: 8, targetRepsMin: 8, targetRepsMax: 12, sets: 3, restSeconds: 90, note: '椅背 30°' }] }
    const currentDefinition = { ...bench }
    const started = makeSession(routine, [currentDefinition], [older, newer])
    expect(started.exercises[0]).toMatchObject({ exerciseDefinitionId: bench.id, sourceExerciseId: 'push-slot', name: '臥推', equipment: '啞鈴', variation: '平板', targetRepsMin: 8, targetRepsMax: 12 })
    expect(started.exercises[0].sets.map((row) => [row.weight, row.reps, row.rir])).toEqual([[22, 10, null], [22, 9, null], [22, 9, null]])
    routine.exercises[0].targetRepsMin = 6
    currentDefinition.name = '新名稱'
    expect(started.exercises[0].targetRepsMin).toBe(8)
    expect(started.exercises[0].name).toBe('臥推')
  })

  it('preserves PR calculation regardless of RIR', () => {
    const history = findExerciseHistory(identity(), [older, newer])
    const before = calculateExercisePr(history)
    const withRir = history.map((entry) => ({ ...entry, sets: entry.sets.map((row) => ({ ...row, rir: 0 as const })) }))
    expect(calculateExercisePr(withRir).weightPr?.id).toBe(before.weightPr?.id)
    expect(calculateExercisePr(withRir).estimatedOneRepMaxPr?.estimateKg).toBe(before.estimatedOneRepMaxPr?.estimateKg)
  })
})

describe('targets, progression, rest and CSV', () => {
  it('normalizes a single target and rejects invalid ranges', () => {
    expect(normalizeTargetRange(null, null)).toEqual({ targetRepsMin: null, targetRepsMax: null })
    expect(normalizeTargetRange(10, null)).toEqual({ targetRepsMin: 10, targetRepsMax: 10 })
    expect(() => normalizeTargetRange(12, 8)).toThrow()
    expect(() => normalizeTargetRange(0, 10)).toThrow()
    expect(formatTargetRange(8, 12)).toBe('8～12 下')
  })

  it('covers every Double Progression case', () => {
    const rows = [set('a', 20, 12), set('b', 20, 12)]
    expect(getProgressionSuggestion(8, 12, rows).kind).toBe('increase')
    expect(getProgressionSuggestion(8, 12, [{ ...rows[0], rir: 0 }, rows[1]]).kind).toBe('hold-limit')
    expect(getProgressionSuggestion(8, 12, [set('a', 20, 10), set('b', 20, 8)]).kind).toBe('add-reps')
    expect(getProgressionSuggestion(8, 12, [set('a', 20, 8), set('b', 20, 7)]).kind).toBe('below-range')
    expect(getProgressionSuggestion(null, null, rows).kind).toBe('none')
    expect(getProgressionSuggestion(8, 12, [set('a', 20, 12, false)]).kind).toBe('none')
  })

  it('keeps background rest correct and supports +/- 15 seconds', () => {
    const working = set('s', 20, 10, false)
    const end = nextRestEndAfterToggle(working, true, 90, 100_000, null)
    expect(end).toBe(190_000)
    expect(remainingRestSeconds(end, 161_500)).toBe(29)
    expect(remainingRestSeconds(end, 210_000)).toBe(0)
    expect(shiftRestEnd(end, 15, 120_000)).toBe(205_000)
    expect(shiftRestEnd(end, -15, 180_000)).toBeNull()
  })

  it('keeps kg storage and RIR/targets in CSV', () => {
    const nextKg = adjustWeightKg(20, 'lb', 1)
    expect(nextKg).toBeCloseTo(20.457, 3)
    expect(displayWeight(nextKg, 'lb')).toBe('45.1')
    expect(adjustReps(0, -1)).toBe(0)
    const finished = session('finished', '2026-09-25T10:00:00Z', [exercise('e', bench.id, [set('a', 20, 10, true, 'working', 4), set('b', 10, 12, true, 'warmup')])])
    expect(completedWorkingVolumeKg(finished)).toBe(200)
    expect(serializeCsv([finished])).toContain('"平板","1","正式","20","10","是","4","8","12"')
    expect(durationMinutes(finished.startedAt, '2026-09-25T11:08:30Z')).toBe(68)
    expect(formatDuration(68)).toBe('1 小時 08 分')
  })
})
