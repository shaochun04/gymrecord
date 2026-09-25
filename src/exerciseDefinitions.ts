import { MUSCLE_GROUPS, type ExerciseDefinition, type MuscleGroup } from './types'
import { createId } from './id'

export function newDefinition(): ExerciseDefinition {
  return { id: createId(), name: '', equipment: '', variation: '', primaryMuscles: [], secondaryMuscles: [], archived: false }
}

export const MUSCLE_LABELS: Record<MuscleGroup, string> = {
  chest: '胸', lats: '背闊肌', upperBack: '上背', traps: '斜方肌',
  frontDelts: '前三角', sideDelts: '側三角', rearDelts: '後三角',
  biceps: '二頭', triceps: '三頭', forearms: '前臂', quads: '股四頭',
  hamstrings: '腿後側', glutes: '臀', adductors: '內收肌', calves: '小腿',
  core: '核心', lowerBack: '下背',
}

export function normalizeExerciseText(value: string) {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ')
}

export function legacyExerciseKey(name: string, equipment: string) {
  return JSON.stringify([normalizeExerciseText(name), normalizeExerciseText(equipment)])
}

export function definitionSubtitle(definition: Pick<ExerciseDefinition, 'equipment' | 'variation'>) {
  return [definition.equipment, definition.variation].filter(Boolean).join(' · ') || '未設定器材／變化'
}

export function definitionLabel(definition: Pick<ExerciseDefinition, 'name' | 'equipment' | 'variation'>) {
  return `${definition.name} · ${definitionSubtitle(definition)}`
}

export function validateDefinition(definition: ExerciseDefinition) {
  if (!definition.id || !normalizeExerciseText(definition.name)) throw new Error('請輸入動作名稱')
  const primary = new Set(definition.primaryMuscles)
  const secondary = new Set(definition.secondaryMuscles)
  if (primary.size !== definition.primaryMuscles.length || secondary.size !== definition.secondaryMuscles.length ||
    [...primary, ...secondary].some((muscle) => !MUSCLE_GROUPS.includes(muscle) || (primary.has(muscle) && secondary.has(muscle)))) {
    throw new Error('主要與次要肌群不可重複，且必須使用有效肌群')
  }
}
