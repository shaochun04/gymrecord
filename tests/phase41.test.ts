import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { serializeCsv } from '../src/data/backup'
import { parseBackupText } from '../src/data/backupSchema'
import { makeSession } from '../src/data/session'
import { initialScreenForActiveSession, makeAppHistoryState, readAppHistoryState } from '../src/navigation'
import { exerciseVolumeSeries, validateCompletedSessionEdit } from '../src/phase4Logic'
import { ActiveSessionLease } from '../src/sessionLease'
import type { ExerciseDefinition, Routine, SetLog, WorkoutSession } from '../src/types'
import { localDateKey } from '../src/utils'
import { calculateExercisePr, canChangeExerciseIdentity, findExerciseHistory, findPreviousPerformance, getProgressionSuggestion } from '../src/workoutLogic'

const definition: ExerciseDefinition = { id: 'bench', name: '臥推', equipmentOptions: ['啞鈴', '槓鈴', '史密斯'], variationOptions: ['平板', '上斜'], primaryMuscles: ['chest'], secondaryMuscles: ['triceps'], archived: false }
const set = (id: string, weight: number, reps: number, kind: SetLog['kind'] = 'working', done = true): SetLog =>
  ({ id, weight, reps, rir: 2, done, kind })
function record(id: string, equipment: string, variation: string, weight: number, reps = 10, startedAt = '2026-09-25T10:00:00.000Z', status: WorkoutSession['status'] = 'completed'): WorkoutSession {
  return { id, routineId: 'push', routineName: 'Push', startedAt, endedAt: status === 'completed' ? '2026-09-25T11:00:00.000Z' : null,
    status, restEndsAt: null, exercises: [{ id: `exercise-${id}`, sourceExerciseId: 'slot', exerciseDefinitionId: definition.id,
      name: definition.name, equipment, variation, note: '', restSeconds: 90, targetRepsMin: 8, targetRepsMax: 12,
      sets: [set(`set-${id}`, weight, reps)] }] }
}

describe('v4 exercise identity', () => {
  const dumbbellFlat = record('db-flat', '啞鈴', '平板', 22, 10, '2026-09-25T10:00:00.000Z')
  const barbellFlat = record('bar-flat', '槓鈴', '平板', 80, 8, '2026-09-24T10:00:00.000Z')
  const smithFlat = record('smith-flat', '史密斯', '平板', 70, 9, '2026-09-23T10:00:00.000Z')
  const dumbbellIncline = record('db-incline', '啞鈴', '上斜', 18, 12, '2026-09-22T10:00:00.000Z')
  const sessions = [dumbbellFlat, barbellFlat, smithFlat, dumbbellIncline]

  it('keeps previous, PR, and volume trend separate by equipment and variation', () => {
    const identity = dumbbellFlat.exercises[0]
    expect(findPreviousPerformance(identity, sessions)?.sets[0].weight).toBe(22)
    expect(calculateExercisePr(findExerciseHistory(identity, sessions)).weightPr?.weight).toBe(22)
    expect(exerciseVolumeSeries(identity, sessions).map((point) => point.volumeKg)).toEqual([220])
    expect(findPreviousPerformance(barbellFlat.exercises[0], sessions)?.sets[0].weight).toBe(80)
    expect(findPreviousPerformance(dumbbellIncline.exercises[0], sessions)?.sets[0].weight).toBe(18)
  })

  it('prefills and calculates progression from the exact variant only', () => {
    const routine: Routine = { id: 'push', name: 'Push', label: '', accent: '#fff', order: 0, updatedAt: '2026-09-26T00:00:00.000Z',
      exercises: [{ id: 'slot', exerciseDefinitionId: definition.id, defaultEquipment: '啞鈴', defaultVariation: '平板', weight: 10, reps: 5, targetRepsMin: 8, targetRepsMax: 10, sets: 2, restSeconds: 90, note: '' }] }
    const next = makeSession(routine, [definition], sessions)
    expect(next.exercises[0].sets.map((row) => [row.weight, row.reps])).toEqual([[22, 10], [22, 10]])
    expect(getProgressionSuggestion(8, 10, findPreviousPerformance(next.exercises[0], sessions)!.sets).kind).toBe('increase')
  })

  it('allows changing a variant after warmup but locks after a completed working set', () => {
    const exercise = structuredClone(dumbbellFlat.exercises[0])
    exercise.sets = [set('warm', 10, 10, 'warmup')]
    expect(canChangeExerciseIdentity(exercise)).toBe(true)
    exercise.sets.push(set('working', 20, 10))
    expect(canChangeExerciseIdentity(exercise)).toBe(false)
  })
})

describe('history corrections and export', () => {
  it('allows adding/deleting sets and changing the recorded variant, then recalculates statistics', () => {
    const original = record('original', '啞鈴', '平板', 20)
    const edited = structuredClone(original)
    edited.exercises[0].equipment = '槓鈴'
    edited.exercises[0].sets = [set('replacement', 60, 8), set('extra', 60, 7)]
    expect(() => validateCompletedSessionEdit(original, edited)).not.toThrow()
    expect(findExerciseHistory(original.exercises[0], [edited])).toEqual([])
    expect(calculateExercisePr(findExerciseHistory(edited.exercises[0], [edited])).weightPr?.weight).toBe(60)
    edited.exercises[0].sets.pop()
    expect(() => validateCompletedSessionEdit(original, edited)).not.toThrow()
  })

  it('exports local date plus actual equipment and variation snapshots', () => {
    const session = record('csv', '史密斯', '上斜', 60)
    session.startedAt = new Date(2026, 8, 26, 0, 30).toISOString()
    const csv = serializeCsv([session])
    expect(csv).toContain(`\"${localDateKey(session.startedAt)}\"`)
    expect(csv).toContain('"器材","變化"')
    expect(csv).toContain('"史密斯","上斜"')
  })
})

describe('PWA recovery, navigation, and multi-context protection', () => {
  it('restores an active session directly to workout and preserves app history state', () => {
    expect(initialScreenForActiveSession(record('active', '啞鈴', '平板', 20, 10, undefined, 'active'))).toBe('workout')
    expect(initialScreenForActiveSession(null)).toBe('home')
    const location = { screen: 'history', selectedRoutineId: null, historyDetailId: 'session', modal: 'routine-editor' as const, editingRoutineId: 'push' }
    expect(readAppHistoryState(makeAppHistoryState(location))).toEqual(location)
    expect(readAppHistoryState({})).toBeNull()
  })

  it('configures pull-to-refresh prevention while retaining normal scrolling', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    expect(css).toMatch(/html,\s*body,\s*\.app-shell\s*\{[^}]*overscroll-behavior-y:\s*none/s)
    expect(css).not.toMatch(/html,\s*body[^}]*overflow-y:\s*hidden/s)
  })

  it('allows only one editor lease for the same active session', () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
    const first = new ActiveSessionLease('active', () => {}, storage, () => 1000, null, 'tab-one')
    const second = new ActiveSessionLease('active', () => {}, storage, () => 1000, null, 'tab-two')
    expect(first.acquire()).toBe(true)
    expect(second.acquire()).toBe(false)
    first.release()
    expect(second.acquire()).toBe(true)
    second.release()
  })

  it('releases the editor lease on pagehide so reload can edit immediately', () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
    const listeners = new Map<string, EventListener>()
    const events = { addEventListener: (name: string, listener: EventListenerOrEventListenerObject) => listeners.set(name, listener as EventListener),
      removeEventListener: (name: string) => { listeners.delete(name) } }
    const beforeReload = new ActiveSessionLease('active', () => {}, storage, () => 1000, events as Pick<Window, 'addEventListener' | 'removeEventListener'>, 'old-page')
    const afterReload = new ActiveSessionLease('active', () => {}, storage, () => 1001, null, 'new-page')
    expect(beforeReload.acquire()).toBe(true)
    listeners.get('pagehide')?.(new Event('pagehide'))
    expect(afterReload.acquire()).toBe(true)
    afterReload.release()
  })

  it('migrates a v3 active session to v4 without losing sets, RIR, or snapshots', () => {
    const active = record('active-v3', '啞鈴', '上斜', 24, 9, undefined, 'active')
    const backup = { format: 'gymrecord-backup', version: 3, exportedAt: '2026-09-26T00:00:00.000Z',
      exerciseDefinitions: [{ id: 'bench', name: '臥推', equipment: '啞鈴', variation: '上斜', primaryMuscles: ['chest'], secondaryMuscles: ['triceps'], archived: false }],
      routines: [{ id: 'push', name: 'Push', label: '', accent: '#fff', order: 0, updatedAt: '2026-09-25T00:00:00.000Z', exercises: [
        { id: 'slot', exerciseDefinitionId: 'bench', weight: 20, reps: 10, targetRepsMin: 8, targetRepsMax: 12, sets: 3, restSeconds: 90, note: '' },
      ] }], sessions: [active], settings: [{ id: 'main', unit: 'kg', restTimerEnabled: true }] }
    const migrated = parseBackupText(JSON.stringify(backup))
    expect(migrated.sessions[0]).toMatchObject({ id: 'active-v3', status: 'active' })
    expect(migrated.sessions[0].exercises[0]).toMatchObject({ equipment: '啞鈴', variation: '上斜' })
    expect(migrated.sessions[0].exercises[0].sets[0]).toMatchObject({ weight: 24, reps: 9, rir: 2 })
    expect(migrated.routines[0].exercises[0]).toMatchObject({ defaultEquipment: '啞鈴', defaultVariation: '上斜' })
  })
})
