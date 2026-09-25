import type { Unit, WorkoutSession } from './types'

export const KG_TO_LB = 2.2046226218

export function displayWeight(weightKg: number | null, unit: Unit) {
  if (weightKg === null) return ''
  const value = unit === 'lb' ? weightKg * KG_TO_LB : weightKg
  return String(Math.round(value * 10) / 10)
}

export function weightToKg(value: number | null, unit: Unit) {
  if (value === null) return null
  return unit === 'lb' ? Math.round(value / KG_TO_LB * 1000) / 1000 : value
}

export function formatDate(iso: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('zh-TW', options ?? { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(iso))
}

export function completedSetCount(session: WorkoutSession) {
  return session.exercises.reduce((total, exercise) => total + exercise.sets.filter((set) => set.done).length, 0)
}

export function plannedSetCount(session: WorkoutSession) {
  return session.exercises.reduce((total, exercise) => total + exercise.sets.length, 0)
}

export function localDateKey(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
