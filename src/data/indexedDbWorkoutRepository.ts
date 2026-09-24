import Dexie, { liveQuery, type EntityTable } from 'dexie'
import { makeInitialRoutines } from '../seed'
import type { AppSettings, Routine, WorkoutSession } from '../types'
import type { WorkoutData, WorkoutRepository } from './workoutRepository'

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

export class IndexedDbWorkoutRepository implements WorkoutRepository {
  async initialize() {
    await db.transaction('rw', db.routines, db.settings, async () => {
      if (await db.routines.count() === 0) await db.routines.bulkPut(makeInitialRoutines())
      if (!(await db.settings.get('main'))) {
        await db.settings.put({ id: 'main', unit: 'kg', restTimerEnabled: true })
      }
    })
  }

  subscribe(onChange: (data: WorkoutData) => void, onError: (error: unknown) => void) {
    const subscription = liveQuery(() => this.readAll()).subscribe({ next: onChange, error: onError })
    return () => subscription.unsubscribe()
  }

  async getActiveSession() {
    return await db.sessions.where('status').equals('active').first() ?? null
  }

  async saveRoutine(routine: Routine) { await db.routines.put(routine) }
  async deleteRoutine(id: string) { await db.routines.delete(id) }
  async saveSession(session: WorkoutSession) { await db.sessions.put(session) }
  async deleteSession(id: string) { await db.sessions.delete(id) }
  async saveSettings(settings: AppSettings) { await db.settings.put(settings) }

  async readAll(): Promise<WorkoutData> {
    return db.transaction('r', db.routines, db.sessions, db.settings, async () => {
      const [routines, sessions, settings] = await Promise.all([
        db.routines.orderBy('order').toArray(),
        db.sessions.orderBy('startedAt').reverse().toArray(),
        db.settings.get('main'),
      ])
      if (!settings) throw new Error('無法讀取設定')
      return { routines, sessions, settings }
    })
  }

  async replaceAll(data: WorkoutData) {
    await db.transaction('rw', db.routines, db.sessions, db.settings, async () => {
      await Promise.all([db.routines.clear(), db.sessions.clear(), db.settings.clear()])
      await db.routines.bulkPut(data.routines)
      await db.sessions.bulkPut(data.sessions)
      await db.settings.put(data.settings)
    })
  }
}
