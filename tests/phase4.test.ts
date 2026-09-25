import { describe, expect, it } from 'vitest'
import type { ExerciseDefinition, Routine, SetLog, WorkoutSession } from '../src/types'
import { calculateExercisePr, completedWorkingVolumeKg, findExerciseHistory, findPreviousPerformance } from '../src/workoutLogic'
import { weeklyMuscleStats } from '../src/muscleStats'
import { cloneRoutine, exerciseVolumeSeries, moveSessionExercise, newSessionPrs, unfinishedSessionCounts, validateCompletedSessionEdit } from '../src/phase4Logic'

const definition: ExerciseDefinition = { id: 'db-incline', name: '臥推', equipment: '啞鈴', variation: '上斜', primaryMuscles: ['chest'], secondaryMuscles: ['frontDelts'], archived: false }
const row = (id: string, weight: number | null, reps: number | null, done = true, kind: SetLog['kind'] = 'working', rir: SetLog['rir'] = null): SetLog =>
  ({ id, weight, reps, done, kind, rir })
function session(id: string, sets: SetLog[], startedAt = '2026-09-23T10:00:00.000Z', status: WorkoutSession['status'] = 'completed'): WorkoutSession {
  return { id, routineId: id === 'push' ? 'push' : 'upper', routineName: id, startedAt,
    endedAt: status === 'completed' ? '2026-09-23T11:00:00.000Z' : null, status, restEndsAt: null,
    exercises: [{ id: `exercise-${id}`, sourceExerciseId: `slot-${id}`, exerciseDefinitionId: definition.id,
      name: definition.name, equipment: definition.equipment, variation: definition.variation,
      note: id, restSeconds: 90, targetRepsMin: 8, targetRepsMax: 12, sets }] }
}

describe('completed session correction', () => {
  it('changes derived PR, volume, and primary muscle sets without modifying identity', () => {
    const previous = session('push', [row('old', 20, 10)], '2026-09-21T10:00:00.000Z')
    const original = session('upper', [row('mistake', 200, 10), row('unfinished', 10, 12, false)])
    const corrected = structuredClone(original)
    corrected.exercises[0].sets[0] = row('mistake', 22, 10, true, 'working', 2)
    corrected.exercises[0].sets[1] = row('unfinished', 10, 12, true, 'warmup')
    expect(() => validateCompletedSessionEdit(original, corrected)).not.toThrow()
    expect(calculateExercisePr(findExerciseHistory(definition.id, [previous, original])).weightPr?.weight).toBe(200)
    expect(calculateExercisePr(findExerciseHistory(definition.id, [previous, corrected])).weightPr?.weight).toBe(22)
    expect(completedWorkingVolumeKg(original)).toBe(2000)
    expect(completedWorkingVolumeKg(corrected)).toBe(220)
    expect(exerciseVolumeSeries(definition.id, [corrected, previous]).map((point) => point.volumeKg)).toEqual([200, 220])
    const week = new Date('2026-09-23T12:00:00.000Z')
    expect(weeklyMuscleStats([previous, original], [definition], week).muscles.find((item) => item.muscle === 'chest')?.sets).toBe(2)
    const noWorking = structuredClone(corrected)
    noWorking.exercises[0].sets[0].done = false
    expect(weeklyMuscleStats([previous, noWorking], [definition], week).muscles.find((item) => item.muscle === 'chest')?.sets).toBe(1)
  })

  it('rejects status, snapshot, ID, negative or invalid set changes', () => {
    const original = session('push', [row('a', 20, 10)])
    for (const patch of [
      (edited: WorkoutSession) => { edited.status = 'active' },
      (edited: WorkoutSession) => { edited.exercises[0].exerciseDefinitionId = 'other' },
      (edited: WorkoutSession) => { edited.exercises[0].name = 'renamed' },
      (edited: WorkoutSession) => { edited.exercises[0].sets[0].weight = -1 },
      (edited: WorkoutSession) => { edited.exercises[0].sets[0].reps = -1 },
      (edited: WorkoutSession) => { edited.exercises[0].sets[0].rir = 5 as SetLog['rir'] },
    ]) {
      const edited = structuredClone(original)
      patch(edited)
      expect(() => validateCompletedSessionEdit(original, edited)).toThrow()
    }
  })
})

describe('session and routine convenience', () => {
  it('warns about undone working sets and exercises, while allowing partial completion', () => {
    const current = session('active', [row('a', 20, 10), row('b', 20, 10, false), row('warm', 10, 10, false, 'warmup')], undefined, 'active')
    current.exercises.push({ ...structuredClone(current.exercises[0]), id: 'second', sets: [row('c', 10, 10, false)] })
    expect(unfinishedSessionCounts(current)).toEqual({ workingSets: 2, exercises: 1 })
    expect(unfinishedSessionCounts({ ...current, exercises: [] })).toEqual({ workingSets: 0, exercises: 0 })
  })

  it('reorders only the active session, retaining the exact exercise and set objects', () => {
    const current = session('active', [row('a', 20, 10)], undefined, 'active')
    current.exercises.push({ ...structuredClone(current.exercises[0]), id: 'second', sets: [row('b', 30, 8)] })
    const moved = moveSessionExercise(current, 'second', -1)
    expect(moved.exercises.map((item) => item.id)).toEqual(['second', 'exercise-active'])
    expect(moved.exercises[0]).toBe(current.exercises[1])
    expect(current.exercises.map((item) => item.id)).toEqual(['exercise-active', 'second'])
    expect(moveSessionExercise({ ...current, status: 'completed' }, 'second', -1).exercises).toEqual(current.exercises)
  })

  it('clones a routine with fresh routine and slot IDs but unchanged global definitions and notes', () => {
    const routine: Routine = { id: 'push', name: 'Push', label: '胸', accent: '#abc', order: 0, updatedAt: '2026-09-20T10:00:00.000Z',
      exercises: [{ id: 'slot', exerciseDefinitionId: definition.id, weight: 22, reps: 10, targetRepsMin: 8, targetRepsMax: 12, sets: 3, restSeconds: 90, note: '椅背 30°' }] }
    const cloned = cloneRoutine(routine, 5)
    expect(cloned).toMatchObject({ name: 'Push Copy', order: 5 })
    expect(cloned.id).not.toBe(routine.id)
    expect(cloned.exercises[0].id).not.toBe(routine.exercises[0].id)
    expect({ ...cloned.exercises[0], id: routine.exercises[0].id }).toEqual(routine.exercises[0])
    expect(cloned.exercises[0].exerciseDefinitionId).toBe(definition.id)
  })
})

describe('PR completion and shared global identity', () => {
  it('shows only new weight and same-weight reps records against prior completed sessions', () => {
    const previous = session('push', [row('old', 20, 10), row('old2', 22, 8)], '2026-09-21T10:00:00.000Z')
    const current = session('upper', [row('newWeight', 24, 8), row('moreReps', 20, 12), row('warm', 30, 15, true, 'warmup')])
    const prs = newSessionPrs(current, [previous, current])
    expect(prs.filter((item) => item.kind === 'weight').map((item) => item.set.id)).toEqual(['newWeight'])
    expect(prs.filter((item) => item.kind === 'reps' && item.set.weight === 20).map((item) => item.set.id)).toEqual(['moreReps'])
    expect(newSessionPrs({ ...current, status: 'active' }, [previous])).toEqual([])
    expect(findPreviousPerformance(definition.id, [previous])?.sets[0].id).toBe('old')
  })
})
