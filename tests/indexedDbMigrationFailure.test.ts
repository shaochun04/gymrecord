import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { IndexedDbWorkoutRepository } from '../src/data/indexedDbWorkoutRepository'

describe('v2 to v3 upgrade transaction', () => {
  it('rolls back when malformed legacy data makes migration fail', async () => {
    const old = new Dexie('gymrecord')
    old.version(2).stores({ routines: 'id, order, name', sessions: 'id, status, startedAt, routineId', settings: 'id' })
    const routine = { id: 'broken', name: 'Broken', label: '', accent: '#fff', order: 0,
      updatedAt: '2026-09-20T00:00:00Z', exercises: null }
    await old.table('routines').put(routine)
    await old.table('settings').put({ id: 'main', unit: 'kg', restTimerEnabled: true })
    old.close()

    await expect(new IndexedDbWorkoutRepository().initialize()).rejects.toThrow()

    const check = new Dexie('gymrecord')
    check.version(2).stores({ routines: 'id, order, name', sessions: 'id, status, startedAt, routineId', settings: 'id' })
    expect(await check.table('routines').get('broken')).toEqual(routine)
    expect(await check.table('settings').get('main')).toMatchObject({ unit: 'kg' })
    expect(await check.verno).toBe(2)
    check.close()
  })
})
