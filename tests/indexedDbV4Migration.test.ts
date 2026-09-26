import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { IndexedDbWorkoutRepository } from '../src/data/indexedDbWorkoutRepository'

describe('IndexedDB v3 to v4 upgrade', () => {
  it('groups base definitions and preserves an active session snapshot and sets', async () => {
    const old = new Dexie('gymrecord')
    old.version(3).stores({ exerciseDefinitions: 'id, name, equipment, variation, archived', routines: 'id, order, name', sessions: 'id, status, startedAt, routineId', settings: 'id' })
    await old.table('exerciseDefinitions').bulkPut([
      { id: 'dumbbell', name: '臥推', equipment: '啞鈴', variation: '平板', primaryMuscles: ['chest'], secondaryMuscles: ['triceps'], archived: false },
      { id: 'barbell', name: '臥推', equipment: '槓鈴', variation: '上斜', primaryMuscles: ['chest'], secondaryMuscles: ['frontDelts'], archived: false },
    ])
    await old.table('routines').put({ id: 'push', name: 'Push', label: '', accent: '#fff', order: 0, updatedAt: '2026-09-25T00:00:00.000Z', exercises: [
      { id: 'slot', exerciseDefinitionId: 'barbell', weight: 60, reps: 8, targetRepsMin: 8, targetRepsMax: 10, sets: 3, restSeconds: 120, note: '' },
    ] })
    await old.table('sessions').put({ id: 'active', routineId: 'push', routineName: 'Push', startedAt: '2026-09-26T00:00:00.000Z', endedAt: null, status: 'active', restEndsAt: null, exercises: [
      { id: 'exercise', sourceExerciseId: 'slot', exerciseDefinitionId: 'dumbbell', name: '臥推', equipment: '啞鈴', variation: '平板', note: '', restSeconds: 120, targetRepsMin: 8, targetRepsMax: 10,
        sets: [{ id: 'set', weight: 24, reps: 9, rir: 1, done: true, kind: 'working' }] },
    ] })
    await old.table('settings').put({ id: 'main', unit: 'kg', restTimerEnabled: true })
    old.close()

    const repository = new IndexedDbWorkoutRepository()
    await repository.initialize()
    const definitions = await repository.getExerciseDefinitions()
    expect(definitions).toHaveLength(1)
    const base = definitions[0]
    expect(['dumbbell', 'barbell']).toContain(base.id)
    expect([...base.equipmentOptions].sort()).toEqual(['啞鈴', '槓鈴'].sort())
    expect([...base.variationOptions].sort()).toEqual(['平板', '上斜'].sort())
    expect(base).toMatchObject({ primaryMuscles: ['chest'], secondaryMuscles: [] })
    expect((await repository.getRoutines())[0].exercises[0]).toMatchObject({ exerciseDefinitionId: base.id, defaultEquipment: '槓鈴', defaultVariation: '上斜' })
    const active = await repository.getActiveSession()
    expect(active?.exercises[0]).toMatchObject({ exerciseDefinitionId: base.id, name: '臥推', equipment: '啞鈴', variation: '平板' })
    expect(active?.exercises[0].sets[0]).toMatchObject({ weight: 24, reps: 9, rir: 1, done: true })
  })
})
