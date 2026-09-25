import { describe, expect, it } from 'vitest'
import type { Routine, SessionExercise, SetLog, WorkoutSession } from '../src/types'
import { makeSession } from '../src/data/session'
import { displayWeight } from '../src/utils'
import { normalizeTargetRange, formatTargetRange } from '../src/targetReps'
import { serializeCsv } from '../src/data/backup'
import {
  adjustReps, adjustWeightKg, calculateExercisePr, completedWorkingVolumeKg, durationMinutes,
  findExerciseHistory, findPreviousPerformance, getProgressionSuggestion,
  formatDuration, nextRestEndAfterToggle, remainingRestSeconds, shiftRestEnd,
} from '../src/workoutLogic'

const set = (id: string, weight: number | null, reps: number | null, done = true, kind: SetLog['kind'] = 'working'): SetLog =>
  ({ id, weight, reps, rir: null, done, kind })

const exercise = (id: string, sourceExerciseId: string, sets: SetLog[], name = '啞鈴臥推', equipment = '啞鈴'): SessionExercise =>
  ({ id, sourceExerciseId, name, equipment, note: '椅背 30°', restSeconds: 90, targetRepsMin: null, targetRepsMax: null, sets })

const session = (id: string, startedAt: string, exercises: SessionExercise[], status: WorkoutSession['status'] = 'completed'): WorkoutSession =>
  ({ id, routineId: id, routineName: id, startedAt, endedAt: status === 'completed' ? startedAt : null, status, restEndsAt: null, exercises })

describe('上次訓練紀錄', () => {
  const current = exercise('current', 'source-1', [])

  it('跨菜單找最近一次正式且完成的組，並排除進行中、暖身及未完成組', () => {
    const older = session('other-routine', '2026-08-01T10:00:00Z', [exercise('old', 'source-1', [set('old-set', 20, 10)])])
    const recent = session('recent-routine', '2026-08-03T10:00:00Z', [exercise('recent', 'source-1', [
      set('warmup', 10, 12, true, 'warmup'), set('undone', 25, 8, false), set('done', 22, 9),
    ])])
    const active = session('active', '2026-08-04T10:00:00Z', [exercise('active-exercise', 'source-1', [set('active-set', 30, 8)])], 'active')
    expect(findPreviousPerformance(current, [older, active, recent])?.sets).toEqual([set('done', 22, 9)])
  })

  it('優先依動作來源 ID 配對；舊資料缺 ID 才使用名稱與器材', () => {
    const mismatch = session('newest', '2026-08-05T10:00:00Z', [exercise('other', 'source-2', [set('wrong', 30, 8)])])
    const legacy = session('legacy', '2026-08-04T10:00:00Z', [exercise('legacy-exercise', '', [set('legacy-set', 21, 10)])])
    const exact = session('exact', '2026-08-03T10:00:00Z', [exercise('same-source', 'source-1', [set('exact-set', 20, 10)], '舊名稱')])
    expect(findPreviousPerformance(current, [mismatch, legacy, exact], undefined, 'newest')?.sets[0].id).toBe('legacy-set')
    expect(findPreviousPerformance(current, [mismatch, exact], undefined, 'newest')?.sets[0].id).toBe('exact-set')
    expect(findPreviousPerformance(current, [mismatch], undefined, 'newest')).toBeNull()
  })

  it('比較資料是獨立副本，修改本次或回傳值不會改動歷史', () => {
    const historical = session('historical', '2026-08-01T10:00:00Z', [exercise('old', 'source-1', [set('old-set', 20, 10)])])
    const previous = findPreviousPerformance(current, [historical])!
    previous.sets[0].weight = 30
    current.sets.push(set('new', 25, 8, false))
    expect(historical.exercises[0].sets[0].weight).toBe(20)
    expect(findPreviousPerformance(current, [historical])?.sets[0].weight).toBe(20)
  })
})

describe('跨菜單預填與完整動作歷史', () => {
  const routine: Routine = {
    id: 'push', name: 'Push', label: '', accent: '#fff', order: 0, updatedAt: '2026-09-01T00:00:00Z',
    exercises: [{ id: 'push-press', name: '啞鈴臥推', equipment: '啞鈴', weight: 15, reps: 8, targetRepsMin: 8, targetRepsMax: 12, sets: 4, restSeconds: 90, note: '椅背 30°' }],
  }
  const oldPush = session('push', '2026-09-20T10:00:00Z', [exercise('old-push', 'push-press', [set('old', 20, 10)])])
  const newUpper = session('upper', '2026-09-25T10:00:00Z', [exercise('new-upper', 'upper-press', [
    set('a', 22, 10), set('b', 22, 10), set('c', 20, 12), set('warm', 10, 12, true, 'warmup'), set('undone', 30, 5, false),
  ])])

  it('較新的跨菜單紀錄成為每組預填來源，第四組沿用最後一組', () => {
    const started = makeSession(routine, [oldPush, newUpper])
    expect(started.exercises[0].sets.map((row) => [row.weight, row.reps])).toEqual([
      [22, 10], [22, 10], [20, 12], [20, 12],
    ])
    expect(started.exercises[0].note).toBe('椅背 30°')
    expect([started.exercises[0].targetRepsMin, started.exercises[0].targetRepsMax]).toEqual([8, 12])
    expect(started.exercises[0].sets.every((row) => row.rir === null)).toBe(true)
    expect(findPreviousPerformance(started.exercises[0], [oldPush, newUpper], started.id, routine.id)?.sets.map((row) => row.id)).toEqual(['a', 'b', 'c'])
  })

  it('同菜單來源 ID 優先，舊資料缺 ID 時才在同菜單回退名稱與器材', () => {
    const wrongId = session('push', '2026-09-27T10:00:00Z', [exercise('wrong', 'another-id', [set('wrong-set', 40, 8)])])
    const legacy = session('push', '2026-09-26T10:00:00Z', [exercise('legacy', '', [set('legacy-set', 21, 11)])])
    expect(makeSession(routine, [wrongId, legacy, oldPush]).exercises[0].sets[0].weight).toBe(21)
    expect(makeSession(routine, [wrongId, oldPush]).exercises[0].sets[0].weight).toBe(20)
  })

  it('沒有歷史時使用菜單預設值；有對應組時保留空值', () => {
    expect(makeSession(routine).exercises[0].sets[0].weight).toBe(15)
    const withEmpty = session('push', '2026-09-28T10:00:00Z', [exercise('empty', 'push-press', [set('empty-set', null, 8), set('next', 18, 12)])])
    expect(makeSession(routine, [withEmpty]).exercises[0].sets.map((row) => [row.weight, row.reps])).toEqual([
      [null, 8], [18, 12], [18, 12], [18, 12],
    ])
  })

  it('跨菜單的新到舊歷史保留暖身標記，排除進行中與未完成組', () => {
    const active = session('active', '2026-09-26T10:00:00Z', [exercise('active-ex', 'push-press', [set('active-set', 30, 5)])], 'active')
    const history = findExerciseHistory({ sourceExerciseId: 'push-press', name: '啞鈴臥推', equipment: '啞鈴' }, [oldPush, active, newUpper], routine.id)
    expect(history.map((entry) => entry.sessionId)).toEqual(['upper', 'push'])
    expect(history[0].sets.map((row) => [row.id, row.kind])).toEqual([
      ['a', 'working'], ['b', 'working'], ['c', 'working'], ['warm', 'warmup'],
    ])
    expect(history[0].routineName).toBe('upper')
  })
})

describe('目標次數與 RIR', () => {
  it('目標次數允許留白，單側輸入補成相同值，拒絕無效範圍', () => {
    expect(normalizeTargetRange(null, null)).toEqual({ targetRepsMin: null, targetRepsMax: null })
    expect(normalizeTargetRange(10, null)).toEqual({ targetRepsMin: 10, targetRepsMax: 10 })
    expect(normalizeTargetRange(null, 12)).toEqual({ targetRepsMin: 12, targetRepsMax: 12 })
    expect(() => normalizeTargetRange(12, 8)).toThrow()
    expect(() => normalizeTargetRange(0, 10)).toThrow()
    expect(() => normalizeTargetRange(8.5, 12)).toThrow()
    expect(formatTargetRange(8, 12)).toBe('8～12 下')
    expect(formatTargetRange(10, 10)).toBe('10 下')
  })

  it('Session 保留目標 snapshot，且不複製上一場 RIR', () => {
    const routine: Routine = { id: 'r', name: 'Push', label: '', accent: '#fff', order: 0, updatedAt: '2026-09-01T00:00:00Z',
      exercises: [{ id: 'press', name: '臥推', equipment: '槓鈴', weight: 20, reps: 10, targetRepsMin: 8, targetRepsMax: 12, sets: 1, restSeconds: 90, note: '' }] }
    const past = session('past', '2026-09-20T10:00:00Z', [exercise('old', 'press', [{ ...set('s', 22, 10), rir: 2 }], '臥推', '槓鈴')])
    const started = makeSession(routine, [past])
    routine.exercises[0].targetRepsMin = 6
    expect(started.exercises[0].targetRepsMin).toBe(8)
    expect(started.exercises[0].sets[0]).toMatchObject({ weight: 22, reps: 10, rir: null })
    expect(findExerciseHistory(started.exercises[0], [past], routine.id)[0].sets[0].rir).toBe(2)
  })

  it('Double Progression 涵蓋上限、力竭、區間、低於下限與無資料', () => {
    const rows = [set('a', 20, 12), set('b', 20, 12)]
    expect(getProgressionSuggestion(8, 12, rows).kind).toBe('increase')
    expect(getProgressionSuggestion(8, 12, [{ ...rows[0], rir: 0 }, rows[1]]).kind).toBe('hold-limit')
    expect(getProgressionSuggestion(8, 12, [set('a', 20, 10), set('b', 20, 8)]).kind).toBe('add-reps')
    expect(getProgressionSuggestion(8, 12, [set('a', 20, 8), set('b', 20, 7)]).kind).toBe('below-range')
    expect(getProgressionSuggestion(null, null, rows).kind).toBe('none')
    expect(getProgressionSuggestion(8, 12, [set('a', 20, 12, false)]).kind).toBe('none')
  })

  it('CSV 保留原欄位並輸出 RIR 與目標範圍，舊歷史留白', () => {
    const current = session('new', '2026-09-25T10:00:00Z', [{ ...exercise('e', 'press', [{ ...set('s', 20, 10), rir: 4 }]), targetRepsMin: 8, targetRepsMax: 12 }])
    const old = session('old', '2026-09-20T10:00:00Z', [exercise('e2', 'press', [set('s2', 18, 10)])])
    const csv = serializeCsv([current, old])
    expect(csv).toContain('"已完成","RIR","目標次數下限","目標次數上限"')
    expect(csv).toContain('"20","10","是","4","8","12"')
    expect(csv).toContain('"18","10","是","","",""')
  })
})

describe('即時計算 PR', () => {
  it('只計完成的正式有效組，依重量、同重量次數及 Epley 估算 1RM', () => {
    const current = exercise('current', 'source-1', [])
    const history = findExerciseHistory(current, [
      session('a', '2026-09-20T10:00:00Z', [exercise('a', 'source-1', [set('heavy', 22, 8), set('reps', 20, 12)])]),
      session('b', '2026-09-25T10:00:00Z', [exercise('b', 'source-1', [set('more-reps', 20, 13), set('warm', 40, 20, true, 'warmup'), set('undone', 50, 10, false), set('zero', 0, 20)])]),
      session('active', '2026-09-26T10:00:00Z', [exercise('active', 'source-1', [set('active', 60, 5)])], 'active'),
    ], 'a')
    const prs = calculateExercisePr(history)
    expect(prs.weightPr?.id).toBe('heavy')
    expect(prs.repsPrByWeight).toEqual([{ weightKg: 22, reps: 8 }, { weightKg: 20, reps: 13 }])
    expect(prs.estimatedOneRepMaxPr?.set.id).toBe('more-reps')
    expect(prs.estimatedOneRepMaxPr?.estimateKg).toBeCloseTo(20 * (1 + 13 / 30))
    expect(displayWeight(prs.weightPr!.weight, 'lb')).toBe('48.5')
    expect(prs.weightPr?.weight).toBe(22)
    const withRir = history.map((entry) => ({ ...entry, sets: entry.sets.map((row) => ({ ...row, rir: 0 as const })) }))
    expect(calculateExercisePr(withRir).weightPr?.id).toBe(prs.weightPr?.id)
    expect(calculateExercisePr(withRir).estimatedOneRepMaxPr?.estimateKg).toBe(prs.estimatedOneRepMaxPr?.estimateKg)
  })
})

describe('休息計時', () => {
  const working = set('work', 20, 10, false)

  it('完成正式組和暖身組會重新倒數；取消完成或停用時不會開始', () => {
    expect(nextRestEndAfterToggle(working, true, 90, 100_000, null)).toBe(190_000)
    expect(nextRestEndAfterToggle(set('warm', 10, 10, false, 'warmup'), true, 45, 120_000, 190_000)).toBe(165_000)
    expect(nextRestEndAfterToggle({ ...working, done: true }, true, 90, 120_000, 190_000)).toBe(190_000)
    expect(nextRestEndAfterToggle(working, false, 90, 120_000, null)).toBeNull()
  })

  it('背景暫停後以結束時間重新計算，支援加減與歸零', () => {
    const end = nextRestEndAfterToggle(working, true, 90, 100_000, null)
    expect(remainingRestSeconds(end, 100_000)).toBe(90)
    expect(remainingRestSeconds(end, 161_500)).toBe(29)
    expect(remainingRestSeconds(end, 210_000)).toBe(0)
    expect(shiftRestEnd(end, 15, 120_000)).toBe(205_000)
    expect(shiftRestEnd(end, -15, 180_000)).toBeNull()
    expect(shiftRestEnd(end, -15, 160_000)).toBe(175_000)
  })
})

describe('輸入與完成摘要計算', () => {
  it('kg 與 lb 均以畫面單位加減 1，底層保留 kg，且不產生負值', () => {
    expect(adjustWeightKg(20, 'kg', 1)).toBe(21)
    const nextKg = adjustWeightKg(20, 'lb', 1)
    expect(nextKg).toBeCloseTo(20.457, 3)
    expect(displayWeight(nextKg, 'lb')).toBe('45.1')
    expect(adjustWeightKg(0, 'kg', -1)).toBe(0)
    expect(adjustWeightKg(0, 'lb', -1)).toBe(0)
    expect(adjustReps(10, 1)).toBe(11)
    expect(adjustReps(0, -1)).toBe(0)
  })

  it('只統計完成正式組的 kg 訓練量與訓練時間', () => {
    const finished = session('finished', '2026-08-01T10:00:00Z', [exercise('a', 'source-1', [
      set('a', 20, 10), set('b', 22, 9), set('c', 10, 15, true, 'warmup'), set('d', 30, 8, false),
    ])])
    expect(completedWorkingVolumeKg(finished)).toBe(398)
    expect(durationMinutes(finished.startedAt, '2026-08-01T11:08:30Z')).toBe(68)
    expect(formatDuration(68)).toBe('1 小時 08 分')
    expect(formatDuration(48)).toBe('48 分')
  })
})
