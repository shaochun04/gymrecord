import { describe, expect, it } from 'vitest'
import type { SessionExercise, SetLog, WorkoutSession } from '../src/types'
import { displayWeight } from '../src/utils'
import {
  adjustReps, adjustWeightKg, completedWorkingVolumeKg, durationMinutes, findPreviousPerformance,
  formatDuration, nextRestEndAfterToggle, remainingRestSeconds, shiftRestEnd,
} from '../src/workoutLogic'

const set = (id: string, weight: number | null, reps: number | null, done = true, kind: SetLog['kind'] = 'working'): SetLog =>
  ({ id, weight, reps, done, kind })

const exercise = (id: string, sourceExerciseId: string, sets: SetLog[], name = '啞鈴臥推', equipment = '啞鈴'): SessionExercise =>
  ({ id, sourceExerciseId, name, equipment, note: '椅背 30°', restSeconds: 90, sets })

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
    expect(findPreviousPerformance(current, [mismatch, legacy, exact])?.sets[0].id).toBe('legacy-set')
    expect(findPreviousPerformance(current, [mismatch, exact])?.sets[0].id).toBe('exact-set')
    expect(findPreviousPerformance(current, [mismatch])).toBeNull()
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
