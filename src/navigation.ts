export type AppHistoryLocation = {
  screen: string
  selectedRoutineId: string | null
  historyDetailId: string | null
  modal: 'routine-editor' | 'add-exercise' | null
  editingRoutineId: string | null
}

const KEY = 'gymrecordNavigation'

export function initialScreenForActiveSession(activeSession: unknown) {
  return activeSession ? 'workout' as const : 'home' as const
}

export function makeAppHistoryState(location: AppHistoryLocation) {
  return { [KEY]: location }
}

export function readAppHistoryState(value: unknown): AppHistoryLocation | null {
  if (!value || typeof value !== 'object') return null
  const location = (value as Record<string, unknown>)[KEY]
  if (!location || typeof location !== 'object') return null
  const item = location as Record<string, unknown>
  if (typeof item.screen !== 'string' || !(item.selectedRoutineId === null || typeof item.selectedRoutineId === 'string') ||
    !(item.historyDetailId === null || typeof item.historyDetailId === 'string') ||
    ![null, 'routine-editor', 'add-exercise'].includes(item.modal as null | string) ||
    !(item.editingRoutineId === null || typeof item.editingRoutineId === 'string')) return null
  return location as AppHistoryLocation
}
