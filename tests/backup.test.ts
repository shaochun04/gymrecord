import { describe, expect, it, vi } from 'vitest'
import { importBackup } from '../src/data/backup'
import { parseBackupText, stringifyBackup } from '../src/data/backupSchema'
import type { WorkoutRepository } from '../src/data/workoutRepository'
import type { WorkoutData } from '../src/data/workoutRepository'

const data: WorkoutData = {
  routines: [{
    id: 'push', name: 'Push day', label: '胸', accent: '#abc', order: 0,
    updatedAt: '2026-09-20T10:00:00.000Z',
    exercises: [{ id: 'bench', name: '臥推', equipment: '槓鈴', weight: 30, reps: 10, sets: 3, restSeconds: 90, note: '' }],
  }],
  sessions: [{
    id: 'session-1', routineId: 'push', routineName: 'Push day',
    startedAt: '2026-09-21T10:00:00.000Z', endedAt: '2026-09-21T11:00:00.000Z',
    status: 'completed', restEndsAt: null,
    exercises: [{ id: 'exercise-1', sourceExerciseId: 'bench', name: '臥推', equipment: '槓鈴', note: '', restSeconds: 90,
      sets: [{ id: 'set-1', weight: 30, reps: 10, done: true, kind: 'working' }],
    }],
  }],
  settings: { id: 'main', unit: 'kg', restTimerEnabled: true },
}

function backupObject() { return JSON.parse(stringifyBackup(data)) }

describe('v1 backup format', () => {
  it('exports and imports the existing v1 shape without changing workout data', () => {
    const backup = backupObject()
    expect(backup.version).toBe(1)
    expect(backup.settings).toEqual([data.settings])
    expect(parseBackupText(JSON.stringify(backup))).toEqual(data)
  })

  it('accepts a v1 file created before the migration pipeline', () => {
    const oldBackup = { format: 'gymrecord-backup', version: 1, exportedAt: '2026-09-21T12:00:00.000Z',
      routines: data.routines, sessions: data.sessions, settings: [data.settings] }
    expect(parseBackupText(JSON.stringify(oldBackup))).toEqual(data)
  })

  it('rejects damaged nested data and unsupported versions', () => {
    const damaged = backupObject()
    damaged.sessions[0].exercises[0].sets[0].done = 'yes'
    expect(() => parseBackupText(JSON.stringify(damaged))).toThrow('備份內容不完整')
    expect(() => parseBackupText(JSON.stringify({ ...backupObject(), version: 2 }))).toThrow('備份版本較新')
  })

  it.each([
    ['routine name', (backup: ReturnType<typeof backupObject>) => { backup.routines[0].name = 123 }],
    ['session status', (backup: ReturnType<typeof backupObject>) => { backup.sessions[0].status = 'paused' }],
    ['exercise sets', (backup: ReturnType<typeof backupObject>) => { backup.sessions[0].exercises[0].sets = null }],
    ['set weight', (backup: ReturnType<typeof backupObject>) => { backup.sessions[0].exercises[0].sets[0].weight = 'heavy' }],
    ['settings unit', (backup: ReturnType<typeof backupObject>) => { backup.settings[0].unit = 'stone' }],
  ])('rejects an invalid %s', (_name, damage) => {
    const backup = backupObject()
    damage(backup)
    expect(() => parseBackupText(JSON.stringify(backup))).toThrow('備份內容不完整')
  })

  it('rejects two active sessions before replacing any data', async () => {
    const invalid = backupObject()
    invalid.sessions = [
      { ...data.sessions[0], id: 'a', status: 'active', endedAt: null },
      { ...data.sessions[0], id: 'b', status: 'active', endedAt: null },
    ]
    const replaceAll = vi.fn()
    const repository = { replaceAll } as unknown as WorkoutRepository
    await expect(importBackup(new File([JSON.stringify(invalid)], 'backup.json'), repository)).rejects.toThrow('多筆進行中')
    expect(replaceAll).not.toHaveBeenCalled()
  })

  it('validates every field before a replacement transaction starts', async () => {
    const invalid = backupObject()
    invalid.routines[0].exercises[0].sets = 'three'
    const replaceAll = vi.fn()
    const repository = { replaceAll } as unknown as WorkoutRepository
    await expect(importBackup(new File([JSON.stringify(invalid)], 'backup.json'), repository)).rejects.toThrow('備份內容不完整')
    expect(replaceAll).not.toHaveBeenCalled()
  })
})
