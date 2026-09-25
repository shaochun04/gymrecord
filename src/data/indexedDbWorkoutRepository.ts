import Dexie, { liveQuery, type EntityTable } from 'dexie'
import { makeInitialRoutines } from '../seed'
import type { AppSettings, Routine, WorkoutSession } from '../types'
import type { WorkoutChangeSource } from './workoutChanges'
import { ActiveSessionExistsError, MultipleActiveSessionsError, type WorkoutData, type WorkoutRepository } from './workoutRepository'
import { migrateRoutineV1, migrateSessionV1, type RoutineV1, type WorkoutSessionV1 } from './modelMigration'

const db = new Dexie('gymrecord') as Dexie & {
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

export class IndexedDbWorkoutRepository implements WorkoutRepository {
  async initialize() {
    await db.transaction('rw', db.routines, db.settings, async () => {
      if (await db.routines.count() === 0) await db.routines.bulkPut(makeInitialRoutines())
      if (!(await db.settings.get('main'))) {
        await db.settings.put({ id: 'main', unit: 'kg', restTimerEnabled: true })
      }
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
    return db.transaction('r', db.routines, db.sessions, db.settings, async () => {
      const [routines, sessions, settings] = await Promise.all([
        this.getRoutines(), this.getSessions(), this.getSettings(),
      ])
      return { routines, sessions, settings }
    })
  }

  async replaceAll(data: WorkoutData) {
    if (data.settings.id !== 'main') throw new Error('備份設定資料無效')
    if (data.sessions.filter((session) => session.status === 'active').length > 1) throw new MultipleActiveSessionsError()
    await db.transaction('rw', db.routines, db.sessions, db.settings, async () => {
      await db.routines.clear()
      await db.sessions.clear()
      await db.settings.clear()
      await db.routines.bulkPut(data.routines)
      await db.sessions.bulkPut(data.sessions)
      await db.settings.put(data.settings)
    })
  }
}

export class IndexedDbWorkoutChanges implements WorkoutChangeSource {
  subscribe(onChange: Parameters<WorkoutChangeSource['subscribe']>[0], onError: (error: unknown) => void) {
    const subscriptions = [
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
