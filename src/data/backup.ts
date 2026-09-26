import { parseBackupText, parseBackupWithPreview, stringifyBackup, type BackupPreview } from './backupSchema'
import type { WorkoutRepository } from './workoutRepository'
import type { WorkoutData } from './workoutRepository'
import type { WorkoutSession } from '../types'
import { localDateKey } from '../utils'

export async function exportBackup(repository: WorkoutRepository) {
  downloadBackup(await repository.readAll(), `gymrecord-backup-${localDateKey(new Date())}.json`)
}

export async function exportCsv(repository: WorkoutRepository) {
  const csv = serializeCsv(await repository.getSessions())
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `gymrecord-records-${localDateKey(new Date())}.csv`)
}

export function serializeCsv(sessions: WorkoutSession[]) {
  const rows: Array<Array<string | number>> = [['日期', '菜單', '動作', '器材', '變化', '組別', '類型', '重量', '次數', '已完成', 'RIR', '目標次數下限', '目標次數上限']]
  for (const session of sessions.filter((item) => item.status === 'completed')) {
    for (const exercise of session.exercises) {
      exercise.sets.forEach((set, index) => {
        rows.push([
          localDateKey(session.startedAt), session.routineName, exercise.name, exercise.equipment, exercise.variation,
          index + 1, set.kind === 'warmup' ? '暖身' : '正式', set.weight ?? '', set.reps ?? '', set.done ? '是' : '否',
          set.rir ?? '', exercise.targetRepsMin ?? '', exercise.targetRepsMax ?? '',
        ])
      })
    }
  }
  return '\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}

export async function importBackup(file: File, repository: WorkoutRepository) {
  const data = parseBackupText(await file.text())
  await repository.replaceAll(data)
}

export async function prepareBackupImport(file: File): Promise<{ data: WorkoutData, preview: BackupPreview }> {
  return parseBackupWithPreview(await file.text())
}

export async function importPreparedBackup(data: WorkoutData, repository: WorkoutRepository) {
  const emergency = await repository.readAll()
  downloadBackup(emergency, `gymrecord-emergency-${localDateKey(new Date())}.json`)
  await repository.replaceAll(data)
}

function downloadBackup(data: WorkoutData, name: string) {
  downloadBlob(new Blob([stringifyBackup(data)], { type: 'application/json' }), name)
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
