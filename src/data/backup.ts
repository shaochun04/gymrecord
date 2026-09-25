import { parseBackupText, stringifyBackup } from './backupSchema'
import type { WorkoutRepository } from './workoutRepository'
import type { WorkoutSession } from '../types'

export async function exportBackup(repository: WorkoutRepository) {
  const blob = new Blob([stringifyBackup(await repository.readAll())], { type: 'application/json' })
  downloadBlob(blob, `gymrecord-backup-${new Date().toISOString().slice(0, 10)}.json`)
}

export async function exportCsv(repository: WorkoutRepository) {
  const csv = serializeCsv(await repository.getSessions())
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `gymrecord-records-${new Date().toISOString().slice(0, 10)}.csv`)
}

export function serializeCsv(sessions: WorkoutSession[]) {
  const rows: Array<Array<string | number>> = [['日期', '菜單', '動作', '器材', '組別', '類型', '重量', '次數', '已完成', 'RIR', '目標次數下限', '目標次數上限']]
  for (const session of sessions.filter((item) => item.status === 'completed')) {
    for (const exercise of session.exercises) {
      exercise.sets.forEach((set, index) => {
        rows.push([
          session.startedAt.slice(0, 10), session.routineName, exercise.name, exercise.equipment,
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
