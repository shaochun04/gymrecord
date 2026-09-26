import Dexie, { liveQuery, type EntityTable } from 'dexie'
import { makeInitialData } from '../seed'
import type { AppSettings, ExerciseDefinition, Routine, WorkoutSession } from '../types'
import { normalizeExerciseOptions, normalizeExerciseText, validateDefinition } from '../exerciseDefinitions'
import type { WorkoutChangeSource } from './workoutChanges'
import { ActiveSessionExistsError, MultipleActiveSessionsError, type WorkoutData, type WorkoutRepository } from './workoutRepository'
import { migrateRoutineV1, migrateSessionV1, migrateWorkoutDataV2, migrateWorkoutDataV3,
  type ExerciseDefinitionV3, type RoutineV1, type RoutineV2, type RoutineV3,
  type WorkoutSessionV1, type WorkoutSessionV2, type WorkoutSessionV3 } from './modelMigration'

const db = new Dexie('gymrecord') as Dexie & {
  exerciseDefinitions: EntityTable<ExerciseDefinition, 'id'>
  routines: EntityTable<Routine, 'id'>
  sessions: EntityTable<WorkoutSession, 'id'>
  settings: EntityTable<AppSettings, 'id'>
}

db.version(1).stores({
  routines: 'id, order, name',
  sessions: 'id, status, startedAt, routineId',
  settings: 'id',
})

db.version(2).stores({
  routines: 'id, order, name',
  sessions: 'id, status, startedAt, routineId',
  settings: 'id',
}).upgrade(async (transaction) => {
  await transaction.table('routines').toCollection().modify((routine: RoutineV1) => {
    Object.assign(routine, migrateRoutineV1(routine))
  })
  await transaction.table('sessions').toCollection().modify((session: WorkoutSessionV1) => {
    Object.assign(session, migrateSessionV1(session))
  })
})

db.version(3).stores({
  exerciseDefinitions: 'id, name, equipment, variation, archived',
  routines: 'id, order, name',
  sessions: 'id, status, startedAt, routineId',
  settings: 'id',
}).upgrade(async (transaction) => {
  const routines = await transaction.table('routines').toArray() as RoutineV2[]
  const sessions = await transaction.table('sessions').toArray() as WorkoutSessionV2[]
  const migrated = migrateWorkoutDataV2({ routines, sessions })
  await transaction.table('exerciseDefinitions').bulkPut(migrated.exerciseDefinitions)
  await transaction.table('routines').bulkPut(migrated.routines)
  await transaction.table('sessions').bulkPut(migrated.sessions)
})

db.version(4).stores({
  exerciseDefinitions: 'id, name, archived',
  routines: 'id, order, name',
  sessions: 'id, status, startedAt, routineId',
  settings: 'id',
}).upgrade(async (transaction) => {
  const exerciseDefinitions = await transaction.table('exerciseDefinitions').toArray() as ExerciseDefinitionV3[]
  const routines = await transaction.table('routines').toArray() as RoutineV3[]
  const sessions = await transaction.table('sessions').toArray() as WorkoutSessionV3[]
  const migrated = migrateWorkoutDataV3({ exerciseDefinitions, routines, sessions })
  await transaction.table('exerciseDefinitions').clear()
  await transaction.table('routines').clear()
  await transaction.table('sessions').clear()
  await transaction.table('exerciseDefinitions').bulkPut(migrated.exerciseDefinitions)
  await transaction.table('routines').bulkPut(migrated.routines)
  await transaction.table('sessions').bulkPut(migrated.sessions)
})

export class IndexedDbWorkoutRepository implements WorkoutRepository {
  async initialize() {
    await db.transaction('rw', db.exerciseDefinitions, db.routines, db.settings, async () => {
      if (await db.routines.count() === 0) {
        const initial = makeInitialData()
        await db.exerciseDefinitions.bulkPut(initial.exerciseDefinitions)
        await db.routines.bulkPut(initial.routines)
      }
      if (!(await db.settings.get('main'))) {
        await db.settings.put({ id: 'main', unit: 'kg', restTimerEnabled: true })
      }
    })
  }

  async getExerciseDefinitions() { return db.exerciseDefinitions.orderBy('name').toArray() }
  async saveExerciseDefinition(definition: ExerciseDefinition) {
    const normalized = { ...definition, name: normalizeExerciseText(definition.name),
      equipmentOptions: normalizeExerciseOptions(definition.equipmentOptions),
      variationOptions: normalizeExerciseOptions(definition.variationOptions) }
    validateDefinition(normalized)
    await db.exerciseDefinitions.put(normalized)
  }
  async archiveExerciseDefinition(id: string, archived: boolean) {
    if (!(await db.exerciseDefinitions.get(id))) throw new Error('找不到這個動作')
    await db.exerciseDefinitions.update(id, { archived })
  }
  async mergeExerciseDefinitions(sourceId: string, targetId: string) {
    if (sourceId === targetId) throw new Error('請選擇不同的目標動作')
    return db.transaction('rw', db.exerciseDefinitions, db.routines, db.sessions, async () => {
      const [source, target] = await Promise.all([db.exerciseDefinitions.get(sourceId), db.exerciseDefinitions.get(targetId)])
      if (!source || !target) throw new Error('找不到要合併的動作')
      const [routines, sessions] = await Promise.all([db.routines.toArray(), db.sessions.toArray()])
      const affectedRoutines = routines.filter((routine) => routine.exercises.some((exercise) => exercise.exerciseDefinitionId === sourceId))
      const affectedSessions = sessions.filter((session) => session.exercises.some((exercise) => exercise.exerciseDefinitionId === sourceId))
      await db.routines.bulkPut(affectedRoutines.map((routine) => ({ ...routine, exercises: routine.exercises.map((exercise) =>
        exercise.exerciseDefinitionId === sourceId ? { ...exercise, exerciseDefinitionId: targetId } : exercise) })))
      await db.sessions.bulkPut(affectedSessions.map((session) => ({ ...session, exercises: session.exercises.map((exercise) =>
        exercise.exerciseDefinitionId === sourceId ? { ...exercise, exerciseDefinitionId: targetId } : exercise) })))
      await db.exerciseDefinitions.put({ ...target,
        equipmentOptions: normalizeExerciseOptions([...target.equipmentOptions, ...source.equipmentOptions]),
        variationOptions: normalizeExerciseOptions([...target.variationOptions, ...source.variationOptions]) })
      await db.exerciseDefinitions.update(sourceId, { archived: true })
      return { routines: affectedRoutines.length, sessions: affectedSessions.length }
    })
  }

  async getRoutines() { return db.routines.orderBy('order').toArray() }
  async getSessions() { return db.sessions.orderBy('startedAt').reverse().toArray() }
  async getSession(id: string) { return await db.sessions.get(id) ?? null }
  async getSessionsByDateRange(fromInclusive: string, toExclusive: string) {
    return db.sessions.where('startedAt').between(fromInclusive, toExclusive, true, false).reverse().toArray()
  }
  async getSettings() {
    const settings = await db.settings.get('main')
    if (!settings) throw new Error('無法讀取設定')
    return settings
  }

  async getActiveSession() {
    const active = await db.sessions.where('status').equals('active').limit(2).toArray()
    if (active.length > 1) throw new MultipleActiveSessionsError()
    return active[0] ?? null
  }

  async saveRoutine(routine: Routine) { await db.routines.put(routine) }
  async deleteRoutine(id: string) { await db.routines.delete(id) }
  async saveSession(session: WorkoutSession) {
    await db.transaction('rw', db.sessions, async () => {
      const existing = await db.sessions.get(session.id)
      if (existing?.status === 'completed' && session.status !== 'completed') {
        throw new Error('已完成的訓練不可改回進行中')
      }
      const active = await db.sessions.where('status').equals('active').limit(2).toArray()
      if (active.length > 1) throw new MultipleActiveSessionsError()
      if (session.status === 'active' && active.length === 1 && active[0].id !== session.id) {
        throw new ActiveSessionExistsError(active[0])
      }
      await db.sessions.put(session)
    })
  }
  async deleteSession(id: string) { await db.sessions.delete(id) }
  async saveSettings(settings: AppSettings) {
    if (settings.id !== 'main') throw new Error('設定 ID 必須是 main')
    await db.settings.put(settings)
  }

  async readAll(): Promise<WorkoutData> {
    return db.transaction('r', db.exerciseDefinitions, db.routines, db.sessions, db.settings, async () => {
      const [exerciseDefinitions, routines, sessions, settings] = await Promise.all([
        this.getExerciseDefinitions(), this.getRoutines(), this.getSessions(), this.getSettings(),
      ])
      return { exerciseDefinitions, routines, sessions, settings }
    })
  }

  async replaceAll(data: WorkoutData) {
    if (data.settings.id !== 'main') throw new Error('備份設定資料無效')
    if (data.sessions.filter((session) => session.status === 'active').length > 1) throw new MultipleActiveSessionsError()
    const ids = new Set(data.exerciseDefinitions.map((definition) => definition.id))
    if (data.routines.some((routine) => routine.exercises.some((exercise) => !ids.has(exercise.exerciseDefinitionId))) ||
      data.sessions.some((session) => session.exercises.some((exercise) => !ids.has(exercise.exerciseDefinitionId)))) {
      throw new Error('備份中有找不到的動作定義')
    }
    await db.transaction('rw', db.exerciseDefinitions, db.routines, db.sessions, db.settings, async () => {
      await db.exerciseDefinitions.clear()
      await db.routines.clear()
      await db.sessions.clear()
      await db.settings.clear()
      await db.exerciseDefinitions.bulkPut(data.exerciseDefinitions)
      await db.routines.bulkPut(data.routines)
      await db.sessions.bulkPut(data.sessions)
      await db.settings.put(data.settings)
    })
  }
}

export class IndexedDbWorkoutChanges implements WorkoutChangeSource {
  subscribe(onChange: Parameters<WorkoutChangeSource['subscribe']>[0], onError: (error: unknown) => void) {
    const subscriptions = [
      liveQuery(() => db.exerciseDefinitions.orderBy('name').toArray()).subscribe({
        next: (value) => onChange({ kind: 'exerciseDefinitions', value }), error: onError,
      }),
      liveQuery(() => db.routines.orderBy('order').toArray()).subscribe({
        next: (value) => onChange({ kind: 'routines', value }), error: onError,
      }),
      liveQuery(() => db.sessions.orderBy('startedAt').reverse().toArray()).subscribe({
        next: (value) => onChange({ kind: 'sessions', value }), error: onError,
      }),
      liveQuery(() => db.settings.get('main')).subscribe({
        next: (value) => value ? onChange({ kind: 'settings', value }) : onError(new Error('無法讀取設定')),
        error: onError,
      }),
    ]
    return () => subscriptions.forEach((subscription) => subscription.unsubscribe())
  }
}
