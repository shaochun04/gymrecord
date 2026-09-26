import { MUSCLE_GROUPS, type ExerciseDefinition, type MuscleGroup } from './types'
import { createId } from './id'

export function newDefinition(): ExerciseDefinition {
  return { id: createId(), name: '', equipmentOptions: [], variationOptions: [], primaryMuscles: [], secondaryMuscles: [], archived: false }
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

export function normalizeExerciseOptions(values: string[]) {
  const unique = new Map<string, string>()
  for (const value of values.map(normalizeExerciseText).filter(Boolean)) {
    const key = value.toLocaleLowerCase()
    if (!unique.has(key)) unique.set(key, value)
  }
  return [...unique.values()]
}

export function variantSubtitle(value: { equipment?: string | null, variation?: string | null }) {
  return [value.equipment, value.variation].filter(Boolean).join(' · ') || '訓練時選擇器材／變化'
}

export function definitionSubtitle(definition: Pick<ExerciseDefinition, 'equipmentOptions' | 'variationOptions'>) {
  const equipment = definition.equipmentOptions.length ? `器材：${definition.equipmentOptions.join('、')}` : '器材：訓練時選擇'
  const variation = definition.variationOptions.length ? `變化：${definition.variationOptions.join('、')}` : '變化：訓練時選擇'
  return `${equipment} · ${variation}`
}

export function definitionLabel(definition: Pick<ExerciseDefinition, 'name'>) {
  return definition.name
}

export function validateDefinition(definition: ExerciseDefinition) {
  if (!definition.id || !normalizeExerciseText(definition.name)) throw new Error('請輸入動作名稱')
  const normalizedEquipment = normalizeExerciseOptions(definition.equipmentOptions)
  const normalizedVariation = normalizeExerciseOptions(definition.variationOptions)
  if (normalizedEquipment.length !== definition.equipmentOptions.length || normalizedVariation.length !== definition.variationOptions.length ||
    normalizedEquipment.some((value, index) => value !== definition.equipmentOptions[index]) ||
    normalizedVariation.some((value, index) => value !== definition.variationOptions[index])) {
    throw new Error('器材與變化選項必須移除空白與重複值')
  }
  const primary = new Set(definition.primaryMuscles)
  const secondary = new Set(definition.secondaryMuscles)
  if (primary.size !== definition.primaryMuscles.length || secondary.size !== definition.secondaryMuscles.length ||
    [...primary, ...secondary].some((muscle) => !MUSCLE_GROUPS.includes(muscle) || (primary.has(muscle) && secondary.has(muscle)))) {
    throw new Error('主要與次要肌群不可重複，且必須使用有效肌群')
  }
}
