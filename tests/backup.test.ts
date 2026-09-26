import { describe, expect, it, vi } from 'vitest'
import { importBackup } from '../src/data/backup'
import { parseBackupText, parseBackupWithPreview, stringifyBackup } from '../src/data/backupSchema'
import type { WorkoutData, WorkoutRepository } from '../src/data/workoutRepository'

const data: WorkoutData = {
  exerciseDefinitions: [{ id: 'def-1', name: '臥推', equipmentOptions: ['啞鈴', '槓鈴'], variationOptions: ['上斜'], primaryMuscles: ['chest'], secondaryMuscles: ['triceps'], archived: false }],
  routines: [{ id: 'push', name: 'Push day', label: '胸', accent: '#abc', order: 0, updatedAt: '2026-09-20T10:00:00.000Z',
    exercises: [{ id: 'bench', exerciseDefinitionId: 'def-1', defaultEquipment: '啞鈴', defaultVariation: '上斜', weight: 30, reps: 10, targetRepsMin: 8, targetRepsMax: 12, sets: 3, restSeconds: 90, note: '' }] }],
  sessions: [{ id: 'session-1', routineId: 'push', routineName: 'Push day', startedAt: '2026-09-21T10:00:00.000Z', endedAt: '2026-09-21T11:00:00.000Z',
    status: 'completed', restEndsAt: null, exercises: [{ id: 'exercise-1', sourceExerciseId: 'bench', exerciseDefinitionId: 'def-1', name: '臥推', equipment: '啞鈴', variation: '上斜', note: '', restSeconds: 90, targetRepsMin: 8, targetRepsMax: 12,
      sets: [{ id: 'set-1', weight: 30, reps: 10, rir: 2, done: true, kind: 'working' }] }] }],
  settings: { id: 'main', unit: 'kg', restTimerEnabled: true },
}

function v4() { return JSON.parse(stringifyBackup(data)) }
function v3() {
  const backup = v4()
  backup.version = 3
  backup.exerciseDefinitions = [
    { id: 'def-1', name: '臥推', equipment: ' 啞鈴 ', variation: '上斜', primaryMuscles: ['chest'], secondaryMuscles: ['triceps'], archived: false },
    { id: 'def-bar', name: '臥推', equipment: '槓鈴', variation: '平板', primaryMuscles: ['chest'], secondaryMuscles: ['frontDelts'], archived: false },
  ]
  for (const exercise of backup.routines[0].exercises) {
    delete exercise.defaultEquipment
    delete exercise.defaultVariation
  }
  return backup
}
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

describe('backup v4 and migrations', () => {
  it('exports v4 and round trips all current fields', () => {
    const backup = v4()
    expect(backup.version).toBe(4)
    expect(parseBackupText(JSON.stringify(backup))).toEqual(data)
  })

  it('migrates v3 definitions into one base exercise, defaults, and unchanged session snapshots', () => {
    const migrated = parseBackupText(JSON.stringify(v3()))
    expect(migrated.exerciseDefinitions).toHaveLength(1)
    expect(migrated.exerciseDefinitions[0]).toMatchObject({ id: 'def-1', name: '臥推', equipmentOptions: ['啞鈴', '槓鈴'], variationOptions: ['上斜', '平板'], primaryMuscles: ['chest'], secondaryMuscles: [] })
    expect(migrated.routines[0].exercises[0]).toMatchObject({ exerciseDefinitionId: 'def-1', defaultEquipment: '啞鈴', defaultVariation: '上斜' })
    expect(migrated.sessions[0].exercises[0]).toMatchObject({ exerciseDefinitionId: 'def-1', equipment: '啞鈴', variation: '上斜' })
  })

  it('migrates v2 through v3 and v4 without losing RIR or rep targets', () => {
    const migrated = parseBackupText(JSON.stringify(v2()))
    expect(migrated.exerciseDefinitions).toHaveLength(1)
    expect(migrated.exerciseDefinitions[0]).toMatchObject({ equipmentOptions: ['啞鈴'], variationOptions: [], primaryMuscles: [], secondaryMuscles: [], archived: false })
    expect(migrated.routines[0].exercises[0]).toMatchObject({ id: 'bench', defaultEquipment: '啞鈴', defaultVariation: null, targetRepsMin: 8, targetRepsMax: 12 })
    expect(migrated.sessions[0].exercises[0]).toMatchObject({ name: '臥推', equipment: '啞鈴', variation: '', targetRepsMin: 8, targetRepsMax: 12 })
    expect(migrated.sessions[0].exercises[0].sets[0].rir).toBe(2)
  })

  it('migrates the original v1 shape through every version', () => {
    const migrated = parseBackupText(JSON.stringify(v1()))
    expect(migrated.routines[0].exercises[0]).toMatchObject({ reps: 10, targetRepsMin: 10, targetRepsMax: 10, defaultEquipment: '啞鈴' })
    expect(migrated.sessions[0].exercises[0]).toMatchObject({ targetRepsMin: null, targetRepsMax: null, variation: '' })
    expect(migrated.sessions[0].exercises[0].sets[0].rir).toBeNull()
    expect(migrated.sessions[0].id).toBe('session-1')
  })

  it('leaves the target unknown when v1 default reps are null', () => {
    const old = v1()
    old.routines[0].exercises[0].reps = null
    expect(parseBackupText(JSON.stringify(old)).routines[0].exercises[0]).toMatchObject({ targetRepsMin: null, targetRepsMax: null })
  })

  it('returns a validated import preview before replacement', () => {
    const { data: parsed, preview } = parseBackupWithPreview(JSON.stringify(v3()))
    expect(preview).toMatchObject({ sourceVersion: 3, sessions: 1, routines: 1, exercises: 1 })
    expect(preview.exportedAt).toEqual(expect.any(String))
    expect(parsed.sessions[0].id).toBe('session-1')
  })

  it.each([
    ['invalid muscle', (backup: ReturnType<typeof v4>) => { backup.exerciseDefinitions[0].primaryMuscles = ['wrong'] }],
    ['duplicate option', (backup: ReturnType<typeof v4>) => { backup.exerciseDefinitions[0].equipmentOptions = ['啞鈴', '啞鈴'] }],
    ['missing reference', (backup: ReturnType<typeof v4>) => { backup.routines[0].exercises[0].exerciseDefinitionId = 'missing' }],
    ['invalid variation', (backup: ReturnType<typeof v4>) => { backup.sessions[0].exercises[0].variation = 9 }],
    ['invalid RIR', (backup: ReturnType<typeof v4>) => { backup.sessions[0].exercises[0].sets[0].rir = 5 }],
    ['invalid target', (backup: ReturnType<typeof v4>) => { backup.routines[0].exercises[0].targetRepsMin = 13 }],
    ['invalid set', (backup: ReturnType<typeof v4>) => { backup.sessions[0].exercises[0].sets[0].done = 'yes' }],
  ])('rejects %s in v4 before replacing data', async (_name, damage) => {
    const invalid = v4()
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
    const invalid = v4()
    invalid.sessions = [{ ...invalid.sessions[0], id: 'a', status: 'active', endedAt: null }, { ...invalid.sessions[0], id: 'b', status: 'active', endedAt: null }]
    expect(() => parseBackupText(JSON.stringify(invalid))).toThrow('多筆進行中')
    expect(() => parseBackupText(JSON.stringify({ ...v4(), version: 5 }))).toThrow('備份版本較新')
  })
})
