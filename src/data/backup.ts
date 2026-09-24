import type { AppSettings, Routine, WorkoutSession } from '../types'
import type { WorkoutRepository } from './workoutRepository'

type Backup = {
  format: 'gymrecord-backup'
  version: 1
  routines: Routine[]
  sessions: WorkoutSession[]
  settings: AppSettings[]
}

export async function exportBackup(repository: WorkoutRepository) {
  const { routines, sessions, settings } = await repository.readAll()
  const payload: Backup & { exportedAt: string } = {
    format: 'gymrecord-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    routines,
    sessions,
    settings: [settings],
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  downloadBlob(blob, `gymrecord-backup-${new Date().toISOString().slice(0, 10)}.json`)
}

export async function exportCsv(repository: WorkoutRepository) {
  const { sessions } = await repository.readAll()
  const rows: Array<Array<string | number>> = [['日期', '菜單', '動作', '器材', '組別', '類型', '重量', '次數', '已完成']]
  for (const session of sessions.filter((item) => item.status === 'completed')) {
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

export async function importBackup(file: File, repository: WorkoutRepository) {
  const parsed: unknown = JSON.parse(await file.text())
  if (!isBackup(parsed)) throw new Error('這不是有效的 GYMRECORD 備份檔')
  await repository.replaceAll({
    routines: parsed.routines,
    sessions: parsed.sessions,
    settings: parsed.settings[0],
  })
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

function isBackup(value: unknown): value is Backup {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<Backup>
  return item.format === 'gymrecord-backup' && item.version === 1 &&
    Array.isArray(item.routines) && Array.isArray(item.sessions) && Array.isArray(item.settings) &&
    item.routines.every((routine) => typeof routine.id === 'string' && Array.isArray(routine.exercises)) &&
    item.sessions.every((session) => typeof session.id === 'string' && Array.isArray(session.exercises)) &&
    item.settings.length === 1 && item.settings[0]?.id === 'main'
}
