import { describe, expect, it, vi } from 'vitest'
import { importBackup } from '../src/data/backup'
import { parseBackupText, stringifyBackup } from '../src/data/backupSchema'
import type { WorkoutData, WorkoutRepository } from '../src/data/workoutRepository'

const data: WorkoutData = {
  exerciseDefinitions: [{ id: 'def-1', name: '臥推', equipment: '啞鈴', variation: '上斜', primaryMuscles: ['chest'], secondaryMuscles: ['triceps'], archived: false }],
  routines: [{ id: 'push', name: 'Push day', label: '胸', accent: '#abc', order: 0, updatedAt: '2026-09-20T10:00:00.000Z',
    exercises: [{ id: 'bench', exerciseDefinitionId: 'def-1', weight: 30, reps: 10, targetRepsMin: 8, targetRepsMax: 12, sets: 3, restSeconds: 90, note: '' }] }],
  sessions: [{ id: 'session-1', routineId: 'push', routineName: 'Push day', startedAt: '2026-09-21T10:00:00.000Z', endedAt: '2026-09-21T11:00:00.000Z',
    status: 'completed', restEndsAt: null, exercises: [{ id: 'exercise-1', sourceExerciseId: 'bench', exerciseDefinitionId: 'def-1', name: '臥推', equipment: '啞鈴', variation: '上斜', note: '', restSeconds: 90, targetRepsMin: 8, targetRepsMax: 12,
      sets: [{ id: 'set-1', weight: 30, reps: 10, rir: 2, done: true, kind: 'working' }] }] }],
  settings: { id: 'main', unit: 'kg', restTimerEnabled: true },
}

function v3() { return JSON.parse(stringifyBackup(data)) }
function v2() {
  const backup = v3()
  backup.version = 2
  delete backup.exerciseDefinitions
  for (const routine of backup.routines) for (const exercise of routine.exercises) {
    delete exercise.exerciseDefinitionId
    exercise.name = '臥推'
    exercise.equipment = '啞鈴'
  }
  for (const session of backup.sessions) for (const exercise of session.exercises) {
    delete exercise.exerciseDefinitionId
    delete exercise.variation
  }
  return backup
}
function v1() {
  const backup = v2()
  backup.version = 1
  for (const routine of backup.routines) for (const exercise of routine.exercises) {
    delete exercise.targetRepsMin
    delete exercise.targetRepsMax
  }
  for (const session of backup.sessions) for (const exercise of session.exercises) {
    delete exercise.targetRepsMin
    delete exercise.targetRepsMax
    for (const row of exercise.sets) delete row.rir
  }
  return backup
}

describe('backup v3 and migrations', () => {
  it('exports v3 and round trips all current fields', () => {
    const backup = v3()
    expect(backup.version).toBe(3)
    expect(parseBackupText(JSON.stringify(backup))).toEqual(data)
  })

  it('migrates v2 to v3 without losing RIR or rep targets', () => {
    const migrated = parseBackupText(JSON.stringify(v2()))
    expect(migrated.exerciseDefinitions).toHaveLength(1)
    expect(migrated.exerciseDefinitions[0]).toMatchObject({ variation: '', primaryMuscles: [], secondaryMuscles: [], archived: false })
    expect(migrated.routines[0].exercises[0]).toMatchObject({ id: 'bench', targetRepsMin: 8, targetRepsMax: 12 })
    expect(migrated.sessions[0].exercises[0]).toMatchObject({ name: '臥推', equipment: '啞鈴', variation: '', targetRepsMin: 8, targetRepsMax: 12 })
    expect(migrated.sessions[0].exercises[0].sets[0].rir).toBe(2)
    expect(migrated.routines[0].exercises[0].exerciseDefinitionId).toBe(migrated.sessions[0].exercises[0].exerciseDefinitionId)
  })

  it('migrates the original v1 shape through v2 to v3', () => {
    const migrated = parseBackupText(JSON.stringify(v1()))
    expect(migrated.routines[0].exercises[0]).toMatchObject({ reps: 10, targetRepsMin: 10, targetRepsMax: 10 })
    expect(migrated.sessions[0].exercises[0]).toMatchObject({ targetRepsMin: null, targetRepsMax: null, variation: '' })
    expect(migrated.sessions[0].exercises[0].sets[0].rir).toBeNull()
    expect(migrated.sessions[0].id).toBe('session-1')
  })

  it('leaves the target unknown when v1 default reps are null', () => {
    const old = v1()
    old.routines[0].exercises[0].reps = null
    expect(parseBackupText(JSON.stringify(old)).routines[0].exercises[0]).toMatchObject({ targetRepsMin: null, targetRepsMax: null })
  })

  it.each([
    ['invalid muscle', (backup: ReturnType<typeof v3>) => { backup.exerciseDefinitions[0].primaryMuscles = ['wrong'] }],
    ['overlapping muscles', (backup: ReturnType<typeof v3>) => { backup.exerciseDefinitions[0].secondaryMuscles = ['chest'] }],
    ['missing reference', (backup: ReturnType<typeof v3>) => { backup.routines[0].exercises[0].exerciseDefinitionId = 'missing' }],
    ['invalid variation', (backup: ReturnType<typeof v3>) => { backup.sessions[0].exercises[0].variation = 9 }],
    ['invalid RIR', (backup: ReturnType<typeof v3>) => { backup.sessions[0].exercises[0].sets[0].rir = 5 }],
    ['invalid target', (backup: ReturnType<typeof v3>) => { backup.routines[0].exercises[0].targetRepsMin = 13 }],
    ['invalid set', (backup: ReturnType<typeof v3>) => { backup.sessions[0].exercises[0].sets[0].done = 'yes' }],
  ])('rejects %s in v3 before replacing data', async (_name, damage) => {
    const invalid = v3()
    damage(invalid)
    const replaceAll = vi.fn()
    await expect(importBackup(new File([JSON.stringify(invalid)], 'backup.json'), { replaceAll } as unknown as WorkoutRepository)).rejects.toThrow('備份內容不完整')
    expect(replaceAll).not.toHaveBeenCalled()
  })

  it('rejects invalid v1 before migration', () => {
    const invalid = v1()
    invalid.sessions[0].exercises[0].sets[0].done = 'yes'
    expect(() => parseBackupText(JSON.stringify(invalid))).toThrow('備份內容不完整')
  })

  it('rejects multiple active sessions and future versions', () => {
    const invalid = v3()
    invalid.sessions = [{ ...invalid.sessions[0], id: 'a', status: 'active', endedAt: null }, { ...invalid.sessions[0], id: 'b', status: 'active', endedAt: null }]
    expect(() => parseBackupText(JSON.stringify(invalid))).toThrow('多筆進行中')
    expect(() => parseBackupText(JSON.stringify({ ...v3(), version: 4 }))).toThrow('備份版本較新')
  })
})
