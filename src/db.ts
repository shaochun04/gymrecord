import Dexie, { type EntityTable } from 'dexie'
import { makeInitialRoutines } from './seed'
import type { AppSettings, Routine, WorkoutSession } from './types'

export const db = new Dexie('gymrecord') as Dexie & {
  routines: EntityTable<Routine, 'id'>
  sessions: EntityTable<WorkoutSession, 'id'>
  settings: EntityTable<AppSettings, 'id'>
}

db.version(1).stores({
  routines: 'id, order, name',
  sessions: 'id, status, startedAt, routineId',
  settings: 'id',
})

export async function initializeDatabase() {
  await db.transaction('rw', db.routines, db.settings, async () => {
    if (await db.routines.count() === 0) {
      await db.routines.bulkPut(makeInitialRoutines())
    }
    if (!(await db.settings.get('main'))) {
      await db.settings.put({ id: 'main', unit: 'kg', restTimerEnabled: true })
    }
  })
}

export function makeSession(routine: Routine, previous?: WorkoutSession): WorkoutSession {
  return {
    id: crypto.randomUUID(),
    routineId: routine.id,
    routineName: routine.name,
    startedAt: new Date().toISOString(),
    endedAt: null,
    status: 'active',
    restEndsAt: null,
    exercises: routine.exercises.map((exercise) => {
      const previousExercise = previous?.exercises.find(
        (item) => item.sourceExerciseId === exercise.id ||
          (item.name === exercise.name && item.equipment === exercise.equipment),
      )
      const previousSets = previousExercise?.sets.filter((set) => set.kind === 'working' && set.done) ?? []
      return {
        id: crypto.randomUUID(),
        sourceExerciseId: exercise.id,
        name: exercise.name,
        equipment: exercise.equipment,
        note: exercise.note,
        restSeconds: exercise.restSeconds,
        sets: Array.from({ length: exercise.sets }, (_, index) => ({
          id: crypto.randomUUID(),
          weight: previousSets[index]?.weight ?? previousSets.at(-1)?.weight ?? exercise.weight,
          reps: previousSets[index]?.reps ?? previousSets.at(-1)?.reps ?? exercise.reps,
          done: false,
          kind: 'working' as const,
        })),
      }
    }),
  }
}

export async function exportBackup() {
  const [routines, sessions, settings] = await Promise.all([
    db.routines.toArray(), db.sessions.toArray(), db.settings.toArray(),
  ])
  const payload = {
    format: 'gymrecord-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    routines,
    sessions,
    settings,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  downloadBlob(blob, `gymrecord-backup-${new Date().toISOString().slice(0, 10)}.json`)
}

export async function exportCsv() {
  const sessions = (await db.sessions.toArray()).filter((session) => session.status === 'completed')
  const rows: Array<Array<string | number>> = [['日期', '菜單', '動作', '器材', '組別', '類型', '重量', '次數', '已完成']]
  for (const session of sessions) {
    for (const exercise of session.exercises) {
      exercise.sets.forEach((set, index) => {
        rows.push([
          session.startedAt.slice(0, 10), session.routineName, exercise.name, exercise.equipment,
          index + 1, set.kind === 'warmup' ? '暖身' : '正式', set.weight ?? '', set.reps ?? '', set.done ? '是' : '否',
        ])
      })
    }
  }
  const csv = '\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `gymrecord-records-${new Date().toISOString().slice(0, 10)}.csv`)
}

function csvCell(value: string | number) {
  const text = String(value)
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

type Backup = {
  format: string
  version: number
  routines: Routine[]
  sessions: WorkoutSession[]
  settings: AppSettings[]
}

export async function importBackup(file: File) {
  const parsed: unknown = JSON.parse(await file.text())
  if (!isBackup(parsed)) throw new Error('這不是有效的 GYMRECORD 備份檔')
  await db.transaction('rw', db.routines, db.sessions, db.settings, async () => {
    await Promise.all([db.routines.clear(), db.sessions.clear(), db.settings.clear()])
    await db.routines.bulkPut(parsed.routines)
    await db.sessions.bulkPut(parsed.sessions)
    await db.settings.bulkPut(parsed.settings)
  })
}

function isBackup(value: unknown): value is Backup {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<Backup>
  return item.format === 'gymrecord-backup' && item.version === 1 &&
    Array.isArray(item.routines) && Array.isArray(item.sessions) && Array.isArray(item.settings) &&
    item.routines.every((routine) => typeof routine.id === 'string' && Array.isArray(routine.exercises)) &&
    item.sessions.every((session) => typeof session.id === 'string' && Array.isArray(session.exercises))
}
