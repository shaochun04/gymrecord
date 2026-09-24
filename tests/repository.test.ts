import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { IndexedDbWorkoutChanges, IndexedDbWorkoutRepository } from '../src/data/indexedDbWorkoutRepository'
import { importBackup } from '../src/data/backup'
import { stringifyBackup } from '../src/data/backupSchema'
import { ActiveSessionExistsError, MultipleActiveSessionsError, type WorkoutData } from '../src/data/workoutRepository'

const settings: WorkoutData['settings'] = { id: 'main', unit: 'kg', restTimerEnabled: true }
const routine: WorkoutData['routines'][number] = {
  id: 'push', name: 'Push day', label: '胸', accent: '#abc', order: 0,
  updatedAt: '2026-09-20T10:00:00.000Z', exercises: [],
}
function active(id: string): WorkoutData['sessions'][number] {
  return { id, routineId: 'push', routineName: 'Push day', startedAt: '2026-09-21T10:00:00.000Z',
    endedAt: null, status: 'active', restEndsAt: null, exercises: [] }
}

const repository = new IndexedDbWorkoutRepository()

beforeAll(async () => {
  // Create the original v1 database directly, then open it through the new adapter.
  const legacy = new Dexie('gymrecord')
  legacy.version(1).stores({ routines: 'id, order, name', sessions: 'id, status, startedAt, routineId', settings: 'id' })
  await legacy.table('routines').put(routine)
  await legacy.table('settings').put(settings)
  legacy.close()
  await repository.initialize()
})

describe('IndexedDB repository', () => {
  it('reads records from the original database without a schema migration', async () => {
    expect(await repository.getRoutines()).toEqual([routine])
    expect(await repository.getSettings()).toEqual(settings)
  })

  describe('writes', () => {
    beforeEach(async () => {
      await repository.replaceAll({ routines: [routine], sessions: [], settings })
    })

    it('keeps at most one active session, including concurrent starts', async () => {
      const results = await Promise.allSettled([repository.saveSession(active('a')), repository.saveSession(active('b'))])
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
      expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: expect.any(ActiveSessionExistsError) })
      expect((await repository.getSessions()).filter((session) => session.status === 'active')).toHaveLength(1)
    })

    it('detects an already corrupted database instead of choosing the first active session', async () => {
      const legacy = new Dexie('gymrecord')
      legacy.version(1).stores({ routines: 'id, order, name', sessions: 'id, status, startedAt, routineId', settings: 'id' })
      await legacy.table('sessions').bulkPut([active('a'), active('b')])
      legacy.close()
      await expect(repository.getActiveSession()).rejects.toBeInstanceOf(MultipleActiveSessionsError)
      await expect(repository.saveSession(active('c'))).rejects.toBeInstanceOf(MultipleActiveSessionsError)
    })

    it('rejects a replacement with two active sessions without changing stored data', async () => {
      const before = await repository.readAll()
      await expect(repository.replaceAll({ routines: [], sessions: [active('a'), active('b')], settings }))
        .rejects.toBeInstanceOf(MultipleActiveSessionsError)
      expect(await repository.readAll()).toEqual(before)
    })

    it('rolls back all clears and writes if a late write fails', async () => {
      await repository.saveSession({ ...active('old'), status: 'completed', endedAt: '2026-09-21T11:00:00.000Z' })
      const before = await repository.readAll()
      const invalidSettings = { ...settings, invalidValue: () => undefined }
      await expect(repository.replaceAll({ routines: [{ ...routine, id: 'new' }], sessions: [active('new')],
        settings: invalidSettings })).rejects.toThrow()
      expect(await repository.readAll()).toEqual(before)
    })

    it('round trips a v1 JSON backup through the real repository', async () => {
      await repository.saveSession({ ...active('saved'), status: 'completed', endedAt: '2026-09-21T11:00:00.000Z' })
      const before = await repository.readAll()
      const file = new File([stringifyBackup(before)], 'gymrecord-backup.json', { type: 'application/json' })
      await repository.replaceAll({ routines: [], sessions: [], settings })
      await importBackup(file, repository)
      expect(await repository.readAll()).toEqual(before)
    })

    it('returns a date range without loading it into the UI snapshot', async () => {
      await repository.saveSession({ ...active('earlier'), status: 'completed', endedAt: '2026-09-20T11:00:00.000Z', startedAt: '2026-09-20T10:00:00.000Z' })
      await repository.saveSession({ ...active('later'), status: 'completed', endedAt: '2026-09-22T11:00:00.000Z', startedAt: '2026-09-22T10:00:00.000Z' })
      expect((await repository.getSessionsByDateRange('2026-09-21T00:00:00.000Z', '2026-09-23T00:00:00.000Z')).map((session) => session.id)).toEqual(['later'])
      expect((await repository.getSession('earlier'))?.id).toBe('earlier')
    })

    it('emits collection changes and stops after unsubscribe', async () => {
      const seen: string[] = []
      const changes = new IndexedDbWorkoutChanges()
      const unsubscribe = changes.subscribe((change) => seen.push(change.kind), (error) => { throw error })
      await waitUntil(() => seen.includes('routines') && seen.includes('sessions') && seen.includes('settings'))
      seen.length = 0
      await repository.saveSession(active('new'))
      await waitUntil(() => seen.includes('sessions'))
      expect(seen).toEqual(['sessions'])
      unsubscribe()
      seen.length = 0
      await repository.saveRoutine({ ...routine, name: 'Updated' })
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(seen).toEqual([])
    })
  })
})

async function waitUntil(predicate: () => boolean) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for repository change')
}
