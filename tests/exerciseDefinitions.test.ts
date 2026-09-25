import { describe, expect, it } from 'vitest'
import { legacyExerciseKey, normalizeExerciseText, validateDefinition } from '../src/exerciseDefinitions'
import { migrateWorkoutDataV2, type WorkoutDataV2 } from '../src/data/modelMigration'
import type { ExerciseDefinition } from '../src/types'

const definition: ExerciseDefinition = { id: 'd', name: '臥推', equipment: '啞鈴', variation: '', primaryMuscles: ['chest'], secondaryMuscles: ['triceps'], archived: false }
const legacy: WorkoutDataV2 = {
  routines: [{ id: 'push', name: 'Push', label: '', accent: '#fff', order: 0, updatedAt: '2026-09-20T00:00:00Z', exercises: [
    { id: 'a', name: '  啞鈴  臥推 ', equipment: ' 啞鈴 ', weight: 20, reps: 10, targetRepsMin: 8, targetRepsMax: 12, sets: 3, restSeconds: 90, note: '' },
  ] }, { id: 'upper', name: 'Upper', label: '', accent: '#fff', order: 1, updatedAt: '2026-09-20T00:00:00Z', exercises: [
    { id: 'b', name: '啞鈴 臥推', equipment: '啞鈴', weight: 20, reps: 10, targetRepsMin: 8, targetRepsMax: 12, sets: 3, restSeconds: 90, note: '' },
    { id: 'c', name: '啞鈴 臥推', equipment: '史密斯', weight: 20, reps: 10, targetRepsMin: 8, targetRepsMax: 12, sets: 3, restSeconds: 90, note: '' },
  ] }],
  sessions: [{ id: 'old', routineId: null, routineName: 'Old', startedAt: '2026-09-19T00:00:00Z', endedAt: '2026-09-19T01:00:00Z', status: 'completed', restEndsAt: null,
    exercises: [{ id: 'old-ex', sourceExerciseId: '', name: '舊划船', equipment: 'Cable', note: '', restSeconds: 90, targetRepsMin: null, targetRepsMax: null,
      sets: [{ id: 's', weight: 20, reps: 10, rir: 3, done: true, kind: 'working' }] }] }],
  settings: { id: 'main', unit: 'kg', restTimerEnabled: true },
}

describe('exercise definitions and conservative migration', () => {
  it('normalizes whitespace and Unicode without fuzzy name matching', () => {
    expect(normalizeExerciseText('  啞鈴   臥推  ')).toBe('啞鈴 臥推')
    expect(legacyExerciseKey('  啞鈴   臥推 ', ' 啞鈴 ')).toBe(legacyExerciseKey('啞鈴 臥推', '啞鈴'))
    expect(legacyExerciseKey('啞鈴臥推', '啞鈴')).not.toBe(legacyExerciseKey('啞鈴平板臥推', '啞鈴'))
  })

  it('shares exact matches across routines, separates equipment, and archives history-only definitions', () => {
    const migrated = migrateWorkoutDataV2(legacy)
    expect(migrated.exerciseDefinitions).toHaveLength(3)
    expect(migrated.routines[0].exercises[0].exerciseDefinitionId).toBe(migrated.routines[1].exercises[0].exerciseDefinitionId)
    expect(migrated.routines[1].exercises[1].exerciseDefinitionId).not.toBe(migrated.routines[0].exercises[0].exerciseDefinitionId)
    const historical = migrated.exerciseDefinitions.find((item) => item.name === '舊划船')!
    expect(historical).toMatchObject({ variation: '', primaryMuscles: [], secondaryMuscles: [], archived: true })
    expect(migrated.sessions[0].exercises[0]).toMatchObject({ id: 'old-ex', name: '舊划船', equipment: 'Cable', variation: '', exerciseDefinitionId: historical.id })
    expect(migrated.sessions[0].exercises[0].sets[0].rir).toBe(3)
  })

  it('does not permit overlapping primary and secondary muscles', () => {
    expect(() => validateDefinition(definition)).not.toThrow()
    expect(() => validateDefinition({ ...definition, secondaryMuscles: ['chest'] })).toThrow('不可重複')
  })
})
