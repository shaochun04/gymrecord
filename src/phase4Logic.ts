import type { Routine, SetLog, WorkoutSession } from './types'
import { createId } from './id'
import { exerciseIdentityKey, findExerciseHistory, sameExerciseIdentity, type ExerciseIdentity } from './workoutLogic'
import { normalizeExerciseText } from './exerciseDefinitions'

export function validateCompletedSessionEdit(original: WorkoutSession, edited: WorkoutSession) {
  if (original.status !== 'completed' || edited.status !== 'completed' || original.id !== edited.id) {
    throw new Error('只能編輯同一筆已完成的訓練紀錄')
  }
  if (original.startedAt !== edited.startedAt || original.endedAt !== edited.endedAt ||
    original.routineId !== edited.routineId || original.routineName !== edited.routineName ||
    original.restEndsAt !== edited.restEndsAt ||
    original.exercises.length !== edited.exercises.length) throw new Error('訓練基本資料不可修改')
  edited.exercises.forEach((exercise, index) => {
    const before = original.exercises[index]
    if (exercise.id !== before.id || exercise.sourceExerciseId !== before.sourceExerciseId ||
      exercise.exerciseDefinitionId !== before.exerciseDefinitionId || exercise.name !== before.name ||
      exercise.note !== before.note || exercise.restSeconds !== before.restSeconds ||
      exercise.targetRepsMin !== before.targetRepsMin || exercise.targetRepsMax !== before.targetRepsMax) throw new Error('動作基本資料不可修改')
    if (exercise.equipment !== normalizeExerciseText(exercise.equipment) || exercise.variation !== normalizeExerciseText(exercise.variation) ||
      new Set(exercise.sets.map((set) => set.id)).size !== exercise.sets.length) throw new Error('器材、變化或組別資料無效')
    exercise.sets.forEach((set) => {
      if (!set.id ||
        (set.weight !== null && (!Number.isFinite(set.weight) || set.weight < 0)) ||
        (set.reps !== null && (!Number.isInteger(set.reps) || set.reps < 0)) ||
        (set.rir !== null && ![0, 1, 2, 3, 4].includes(set.rir)) ||
        typeof set.done !== 'boolean' || (set.kind !== 'working' && set.kind !== 'warmup')) {
        throw new Error('組別數值無效：重量與次數不能為負數，RIR 須為 0～4')
      }
    })
  })
}

export function unfinishedSessionCounts(session: WorkoutSession) {
  return {
    workingSets: session.exercises.reduce((sum, exercise) => sum + exercise.sets.filter((set) => set.kind === 'working' && !set.done).length, 0),
    exercises: session.exercises.filter((exercise) => !exercise.sets.some((set) => set.kind === 'working' && set.done)).length,
  }
}

export function moveSessionExercise(session: WorkoutSession, exerciseId: string, direction: -1 | 1): WorkoutSession {
  const index = session.exercises.findIndex((exercise) => exercise.id === exerciseId)
  const target = index + direction
  if (session.status !== 'active' || index < 0 || target < 0 || target >= session.exercises.length) return session
  const exercises = [...session.exercises]
  ;[exercises[index], exercises[target]] = [exercises[target], exercises[index]]
  return { ...session, exercises }
}

export function cloneRoutine(routine: Routine, order: number): Routine {
  return { ...routine, id: createId(), name: `${routine.name} Copy`, order,
    updatedAt: new Date().toISOString(), exercises: routine.exercises.map((exercise) => ({ ...exercise, id: createId() })) }
}

export function exerciseVolumeSeries(identity: ExerciseIdentity, sessions: WorkoutSession[]) {
  return [...sessions].filter((session) => session.status === 'completed')
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .flatMap((session) => {
      const sets = session.exercises.filter((exercise) => sameExerciseIdentity(exercise, identity))
        .flatMap((exercise) => exercise.sets.filter((set) => set.done && set.kind === 'working'))
      if (!sets.length) return []
      return [{ sessionId: session.id, date: session.startedAt,
        volumeKg: sets.reduce((sum, set) => sum + (set.weight ?? 0) * (set.reps ?? 0), 0) }]
    })
}

export type SessionPr = { exerciseDefinitionId: string, name: string, equipment: string, variation: string,
  kind: 'weight' | 'reps', set: SetLog }

export function newSessionPrs(session: WorkoutSession, previousSessions: WorkoutSession[]): SessionPr[] {
  if (session.status !== 'completed') return []
  const results: SessionPr[] = []
  const identities = new Map(session.exercises.map((exercise) => [exerciseIdentityKey(exercise), exercise]))
  for (const label of identities.values()) {
    const currentExercises = session.exercises.filter((exercise) => sameExerciseIdentity(exercise, label))
    const currentSets = currentExercises.flatMap((exercise) => exercise.sets).filter((set) =>
      set.done && set.kind === 'working' && set.weight !== null && set.weight > 0 && set.reps !== null && set.reps > 0)
    if (!currentSets.length) continue
    const previous = findExerciseHistory(label, previousSessions, session.id).flatMap((entry) => entry.sets)
      .filter((set) => set.kind === 'working' && set.weight !== null && set.weight > 0 && set.reps !== null && set.reps > 0)
    const id = label.exerciseDefinitionId
    const currentBest = currentSets.reduce((best, set) => !best || set.weight! > best.weight! ||
      (set.weight === best.weight && set.reps! > best.reps!) ? set : best, null as SetLog | null)!
    const previousMaxWeight = Math.max(0, ...previous.map((set) => set.weight!))
    if (currentBest.weight! > previousMaxWeight) results.push({ exerciseDefinitionId: id, name: label.name,
      equipment: label.equipment, variation: label.variation, kind: 'weight', set: currentBest })
    const byWeight = new Map<number, SetLog>()
    for (const set of currentSets) {
      const best = byWeight.get(set.weight!)
      if (!best || set.reps! > best.reps!) byWeight.set(set.weight!, set)
    }
    for (const [weight, set] of byWeight) {
      const priorAtWeight = previous.filter((item) => item.weight === weight)
      const priorReps = Math.max(0, ...priorAtWeight.map((item) => item.reps!))
      if (priorAtWeight.length > 0 && set.reps! > priorReps) results.push({ exerciseDefinitionId: id, name: label.name,
        equipment: label.equipment, variation: label.variation, kind: 'reps', set })
    }
  }
  return results
}
