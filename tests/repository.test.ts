import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { IndexedDbWorkoutChanges, IndexedDbWorkoutRepository } from '../src/data/indexedDbWorkoutRepository'
import { importBackup } from '../src/data/backup'
import { stringifyBackup } from '../src/data/backupSchema'
import { ActiveSessionExistsError, MultipleActiveSessionsError, type WorkoutData } from '../src/data/workoutRepository'

const settings: WorkoutData['settings'] = { id: 'main', unit: 'kg', restTimerEnabled: true }
const definition: WorkoutData['exerciseDefinitions'][number] = { id: 'db-bench', name: '臥推', equipment: '啞鈴', variation: '平板', primaryMuscles: ['chest'], secondaryMuscles: ['triceps'], archived: false }
const target: WorkoutData['exerciseDefinitions'][number] = { ...definition, id: 'smith-bench', equipment: '史密斯', primaryMuscles: [], secondaryMuscles: [] }
const routine: WorkoutData['routines'][number] = { id: 'push', name: 'Push', label: '胸', accent: '#abc', order: 0,
  updatedAt: '2026-09-20T10:00:00.000Z', exercises: [{ id: 'slot', exerciseDefinitionId: definition.id, weight: 20, reps: 10, targetRepsMin: 8, targetRepsMax: 12, sets: 3, restSeconds: 90, note: '' }] }
function session(id: string, status: 'active' | 'completed' = 'completed'): WorkoutData['sessions'][number] {
  return { id, routineId: 'push', routineName: 'Push', startedAt: '2026-09-21T10:00:00.000Z', endedAt: status === 'completed' ? '2026-09-21T11:00:00.000Z' : null,
    status, restEndsAt: null, exercises: [{ id: `exercise-${id}`, sourceExerciseId: 'slot', exerciseDefinitionId: definition.id, name: '舊名稱', equipment: '舊器材', variation: '舊變化', note: 'snapshot', restSeconds: 90, targetRepsMin: 8, targetRepsMax: 12,
      sets: [{ id: `set-${id}`, weight: 20, reps: 10, rir: 2, done: true, kind: 'working' }] }] }
}
const repository = new IndexedDbWorkoutRepository()

beforeAll(async () => {
  const old = new Dexie('gymrecord')
  old.version(2).stores({ routines: 'id, order, name', sessions: 'id, status, startedAt, routineId', settings: 'id' })
  const legacyRoutine = { ...routine, exercises: [{ ...routine.exercises[0], name: '  臥推  ', equipment: '啞鈴' }] }
  delete legacyRoutine.exercises[0].exerciseDefinitionId
  const legacyUpper = { ...legacyRoutine, id: 'upper', name: 'Upper', exercises: [{ ...legacyRoutine.exercises[0], id: 'upper-slot', name: '臥推' }] }
  const legacySmith = { ...legacyRoutine, id: 'smith', name: 'Smith', exercises: [{ ...legacyRoutine.exercises[0], id: 'smith-slot', equipment: '史密斯' }] }
  const oldSession = (id: string, status: 'active' | 'completed', name: string, equipment: string) => ({
    ...session(id, status), exercises: [{ ...session(id, status).exercises[0], name, equipment, variation: undefined, exerciseDefinitionId: undefined }],
  })
  await old.table('routines').bulkPut([legacyRoutine, legacyUpper, legacySmith])
  await old.table('sessions').bulkPut([
    oldSession('finished', 'completed', '臥推', '啞鈴'),
    oldSession('active', 'active', '臥推', '史密斯'),
    oldSession('historical-only', 'completed', '舊划船', 'Cable'),
  ])
  await old.table('settings').put({ ...settings, unit: 'lb' })
  old.close()
  await repository.initialize()
})

describe('IndexedDB v3 repository', () => {
  it('migrates v2 active/completed sessions and routine slots without guessing variation or muscles', async () => {
    const definitions = await repository.getExerciseDefinitions()
    expect(definitions).toHaveLength(3)
    const dumbbell = definitions.find((item) => item.equipment === '啞鈴')!
    expect(dumbbell).toMatchObject({ name: '臥推', variation: '', primaryMuscles: [], secondaryMuscles: [], archived: false })
    const historical = definitions.find((item) => item.name === '舊划船')!
    expect(historical.archived).toBe(true)
    const routines = await repository.getRoutines()
    expect(routines.find((item) => item.id === 'push')!.exercises[0].exerciseDefinitionId).toBe(dumbbell.id)
    expect(routines.find((item) => item.id === 'upper')!.exercises[0].exerciseDefinitionId).toBe(dumbbell.id)
    expect(routines.find((item) => item.id === 'smith')!.exercises[0].exerciseDefinitionId).not.toBe(dumbbell.id)
    const sessions = await repository.getSessions()
    expect(sessions.map((item) => item.id).sort()).toEqual(['active', 'finished', 'historical-only'])
    expect(sessions.find((item) => item.id === 'active')?.status).toBe('active')
    expect(sessions.find((item) => item.id === 'finished')?.exercises[0]).toMatchObject({ name: '臥推', equipment: '啞鈴', variation: '', targetRepsMin: 8, targetRepsMax: 12 })
    expect(sessions.find((item) => item.id === 'finished')?.exercises[0].sets[0].rir).toBe(2)
    expect((await repository.getSettings()).unit).toBe('lb')
  })

  describe('writes and merge', () => {
    beforeEach(async () => repository.replaceAll({ exerciseDefinitions: [definition, target], routines: [routine], sessions: [], settings }))

    it('keeps at most one active session, including concurrent starts', async () => {
      const results = await Promise.allSettled([repository.saveSession(session('a', 'active')), repository.saveSession(session('b', 'active'))])
      expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1)
      expect(results.find((item) => item.status === 'rejected')).toMatchObject({ reason: expect.any(ActiveSessionExistsError) })
    })

    it('detects already corrupted active sessions', async () => {
      const raw = new Dexie('gymrecord')
      raw.version(3).stores({ exerciseDefinitions: 'id, name, equipment, variation, archived', routines: 'id, order, name', sessions: 'id, status, startedAt, routineId', settings: 'id' })
      await raw.table('sessions').bulkPut([session('a', 'active'), session('b', 'active')])
      raw.close()
      await expect(repository.getActiveSession()).rejects.toBeInstanceOf(MultipleActiveSessionsError)
      await expect(repository.saveSession(session('c', 'active'))).rejects.toBeInstanceOf(MultipleActiveSessionsError)
    })

    it('rejects a replacement with two active sessions without touching stored data', async () => {
      const before = await repository.readAll()
      await expect(repository.replaceAll({ exerciseDefinitions: [definition], routines: [routine], sessions: [session('a', 'active'), session('b', 'active')], settings }))
        .rejects.toBeInstanceOf(MultipleActiveSessionsError)
      expect(await repository.readAll()).toEqual(before)
    })

    it('atomically merges references, archives source, and preserves session display snapshots', async () => {
      await repository.saveSession(session('completed'))
      await repository.saveSession(session('active', 'active'))
      const counts = await repository.mergeExerciseDefinitions(definition.id, target.id)
      expect(counts).toEqual({ routines: 1, sessions: 2 })
      expect((await repository.getRoutines())[0].exercises[0].exerciseDefinitionId).toBe(target.id)
      const sessions = await repository.getSessions()
      expect(sessions.every((item) => item.exercises[0].exerciseDefinitionId === target.id)).toBe(true)
      expect(sessions[0].exercises[0]).toMatchObject({ name: '舊名稱', equipment: '舊器材', variation: '舊變化' })
      expect((await repository.getExerciseDefinitions()).find((item) => item.id === definition.id)?.archived).toBe(true)
    })

    it('leaves data unchanged if a merge target is missing', async () => {
      await repository.saveSession(session('completed'))
      const before = await repository.readAll()
      await expect(repository.mergeExerciseDefinitions(definition.id, 'missing')).rejects.toThrow()
      expect(await repository.readAll()).toEqual(before)
    })

    it('keeps archived definitions for referenced routine and history', async () => {
      await repository.saveSession(session('completed'))
      await repository.archiveExerciseDefinition(definition.id, true)
      expect((await repository.getRoutines())[0].exercises[0].exerciseDefinitionId).toBe(definition.id)
      expect((await repository.getSession('completed'))?.exercises[0].exerciseDefinitionId).toBe(definition.id)
    })

    it('rolls back replacement after a late write failure', async () => {
      await repository.saveSession(session('completed'))
      const before = await repository.readAll()
      const invalidSettings = { ...settings, invalidValue: () => undefined }
      await expect(repository.replaceAll({ exerciseDefinitions: [target], routines: [], sessions: [], settings: invalidSettings })).rejects.toThrow()
      expect(await repository.readAll()).toEqual(before)
    })

    it('round trips a v3 JSON backup through the repository', async () => {
      await repository.saveSession(session('completed'))
      const before = await repository.readAll()
      await repository.replaceAll({ exerciseDefinitions: [], routines: [], sessions: [], settings })
      await importBackup(new File([stringifyBackup(before)], 'backup.json'), repository)
      expect(await repository.readAll()).toEqual(before)
    })

    it('queries sessions by date range and ID', async () => {
      await repository.saveSession(session('earlier'))
      await repository.saveSession({ ...session('later'), startedAt: '2026-09-25T10:00:00.000Z' })
      expect((await repository.getSessionsByDateRange('2026-09-24T00:00:00.000Z', '2026-09-26T00:00:00.000Z')).map((item) => item.id)).toEqual(['later'])
      expect((await repository.getSession('earlier'))?.id).toBe('earlier')
    })

    it('emits definition changes and stops after unsubscribe', async () => {
      const changes = new IndexedDbWorkoutChanges()
      const seen: string[] = []
      const unsubscribe = changes.subscribe((change) => seen.push(change.kind), (error) => { throw error })
      await waitUntil(() => seen.includes('exerciseDefinitions') && seen.includes('routines') && seen.includes('sessions') && seen.includes('settings'))
      seen.length = 0
      await repository.saveExerciseDefinition({ ...definition, name: 'New' })
      await waitUntil(() => seen.includes('exerciseDefinitions'))
      unsubscribe()
      seen.length = 0
      await repository.archiveExerciseDefinition(definition.id, true)
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(seen).toEqual([])
    })
  })
})

async function waitUntil(predicate: () => boolean) {
  for (let i = 0; i < 50; i += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for repository change')
}
