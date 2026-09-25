import type { AppSettings, Routine, RoutineExercise, SessionExercise, SetLog, WorkoutSession } from '../types'
import { MultipleActiveSessionsError, type WorkoutData } from './workoutRepository'
import { migrateRoutineV1, migrateSessionV1, type RoutineExerciseV1, type RoutineV1, type SessionExerciseV1, type SetLogV1, type WorkoutSessionV1 } from './modelMigration'

export const CURRENT_BACKUP_VERSION = 2
const BACKUP_FORMAT = 'gymrecord-backup'

type BackupV1 = {
  format: typeof BACKUP_FORMAT
  version: 1
  exportedAt?: string
  routines: RoutineV1[]
  sessions: WorkoutSessionV1[]
  settings: AppSettings[]
}

type BackupV2 = {
  format: typeof BACKUP_FORMAT
  version: 2
  exportedAt?: string
  routines: Routine[]
  sessions: WorkoutSession[]
  settings: AppSettings[]
}

type Migration = (value: unknown) => unknown

// Each migration must validate the version it reads and return the next version.
const migrations: Partial<Record<number, Migration>> = { 1: migrateV1ToV2 }

export function migrateV1ToV2(value: unknown): BackupV2 {
  if (!isBackupV1(value)) throw new Error('備份內容不完整或資料格式錯誤')
  return {
    ...value,
    version: 2,
    routines: value.routines.map(migrateRoutineV1),
    sessions: value.sessions.map(migrateSessionV1),
  }
}

export function parseBackupText(text: string): WorkoutData {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw new Error('備份檔不是有效的 JSON') }
  if (!isRecord(parsed) || parsed.format !== BACKUP_FORMAT || !Number.isInteger(parsed.version)) {
    throw new Error('這不是有效的 GYMRECORD 備份檔')
  }
  if ((parsed.version as number) > CURRENT_BACKUP_VERSION) throw new Error('備份版本較新，請更新 APP 後再匯入')
  if ((parsed.version as number) < 1) throw new Error('不支援的備份版本')

  let version = parsed.version as number
  let current: unknown = parsed
  while (version < CURRENT_BACKUP_VERSION) {
    const migrate = migrations[version]
    if (!migrate) throw new Error(`缺少版本 ${version} 的備份轉換`)
    current = migrate(current)
    version += 1
    if (!isRecord(current) || current.version !== version || current.format !== BACKUP_FORMAT) {
      throw new Error('備份版本轉換失敗')
    }
  }

  if (!isBackupV2(current)) throw new Error('備份內容不完整或資料格式錯誤')
  if (current.sessions.filter((session) => session.status === 'active').length > 1) {
    throw new MultipleActiveSessionsError()
  }
  return { routines: current.routines, sessions: current.sessions, settings: current.settings[0] }
}

export function stringifyBackup(data: WorkoutData) {
  const payload: BackupV2 = {
    format: BACKUP_FORMAT,
    version: CURRENT_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    routines: data.routines,
    sessions: data.sessions,
    settings: [data.settings],
  }
  return JSON.stringify(payload, null, 2)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isId(value: unknown): value is string { return typeof value === 'string' && value.length > 0 }
function isString(value: unknown): value is string { return typeof value === 'string' }
function isDate(value: unknown): value is string { return isString(value) && !Number.isNaN(Date.parse(value)) }
function isNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function isNullableNumber(value: unknown): value is number | null { return value === null || isNumber(value) }
function isNullableInteger(value: unknown): value is number | null {
  return value === null || (Number.isInteger(value) && isNumber(value))
}
function isArrayOf<T>(value: unknown, check: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(check)
}
function hasUniqueIds(items: { id: string }[]) { return new Set(items.map((item) => item.id)).size === items.length }

function isRoutineExerciseV1(value: unknown): value is RoutineExerciseV1 {
  if (!isRecord(value)) return false
  return isId(value.id) && isString(value.name) && isString(value.equipment) &&
    isNullableNumber(value.weight) && isNullableInteger(value.reps) &&
    Number.isInteger(value.sets) && isNumber(value.sets) &&
    isNumber(value.restSeconds) && isString(value.note)
}

function isRoutineV1(value: unknown): value is RoutineV1 {
  if (!isRecord(value)) return false
  return isId(value.id) && isString(value.name) && isString(value.label) &&
    isString(value.accent) && Number.isInteger(value.order) && isNumber(value.order) &&
    isDate(value.updatedAt) && isArrayOf(value.exercises, isRoutineExerciseV1) && hasUniqueIds(value.exercises)
}

function isSetLogV1(value: unknown): value is SetLogV1 {
  if (!isRecord(value)) return false
  return isId(value.id) && isNullableNumber(value.weight) && isNullableInteger(value.reps) &&
    typeof value.done === 'boolean' && (value.kind === 'working' || value.kind === 'warmup')
}

function isSessionExerciseV1(value: unknown): value is SessionExerciseV1 {
  if (!isRecord(value)) return false
  return isId(value.id) && isString(value.sourceExerciseId) && isString(value.name) &&
    isString(value.equipment) && isString(value.note) && isNumber(value.restSeconds) &&
    isArrayOf(value.sets, isSetLogV1) && hasUniqueIds(value.sets)
}

function isWorkoutSessionV1(value: unknown): value is WorkoutSessionV1 {
  if (!isRecord(value)) return false
  return isId(value.id) && (value.routineId === null || isString(value.routineId)) &&
    isString(value.routineName) && isDate(value.startedAt) &&
    (value.endedAt === null || isDate(value.endedAt)) &&
    (value.status === 'active' || value.status === 'completed') &&
    isNullableNumber(value.restEndsAt) && isArrayOf(value.exercises, isSessionExerciseV1) &&
    hasUniqueIds(value.exercises)
}

function isAppSettings(value: unknown): value is AppSettings {
  if (!isRecord(value)) return false
  return value.id === 'main' && (value.unit === 'kg' || value.unit === 'lb') &&
    typeof value.restTimerEnabled === 'boolean'
}

function isBackupV1(value: unknown): value is BackupV1 {
  if (!isRecord(value)) return false
  return value.format === BACKUP_FORMAT && value.version === 1 &&
    (value.exportedAt === undefined || isDate(value.exportedAt)) &&
    isArrayOf(value.routines, isRoutineV1) && hasUniqueIds(value.routines) &&
    isArrayOf(value.sessions, isWorkoutSessionV1) && hasUniqueIds(value.sessions) &&
    isArrayOf(value.settings, isAppSettings) && value.settings.length === 1
}

function isTargetRange(value: Record<string, unknown>) {
  const min = value.targetRepsMin
  const max = value.targetRepsMax
  return (min === null && max === null) ||
    (Number.isInteger(min) && Number.isInteger(max) && isNumber(min) && isNumber(max) && min >= 1 && min <= max)
}

function isRoutineExerciseV2(value: unknown): value is RoutineExercise {
  return isRoutineExerciseV1(value) && isRecord(value) && isTargetRange(value)
}

function isRoutineV2(value: unknown): value is Routine {
  return isRoutineV1(value) && isRecord(value) && isArrayOf(value.exercises, isRoutineExerciseV2)
}

function isSetLogV2(value: unknown): value is SetLog {
  if (!isRecord(value)) return false
  const rir = value.rir
  return isSetLogV1(value) &&
    (rir === null || rir === 0 || rir === 1 || rir === 2 || rir === 3 || rir === 4)
}

function isSessionExerciseV2(value: unknown): value is SessionExercise {
  return isSessionExerciseV1(value) && isRecord(value) && isTargetRange(value) &&
    isArrayOf(value.sets, isSetLogV2)
}

function isWorkoutSessionV2(value: unknown): value is WorkoutSession {
  return isWorkoutSessionV1(value) && isRecord(value) && isArrayOf(value.exercises, isSessionExerciseV2)
}

function isBackupV2(value: unknown): value is BackupV2 {
  if (!isRecord(value)) return false
  return value.format === BACKUP_FORMAT && value.version === 2 &&
    (value.exportedAt === undefined || isDate(value.exportedAt)) &&
    isArrayOf(value.routines, isRoutineV2) && hasUniqueIds(value.routines) &&
    isArrayOf(value.sessions, isWorkoutSessionV2) && hasUniqueIds(value.sessions) &&
    isArrayOf(value.settings, isAppSettings) && value.settings.length === 1
}
