export function normalizeTargetRange(min: number | null, max: number | null) {
  if (min === null && max === null) return { targetRepsMin: null, targetRepsMax: null }
  const targetRepsMin = min ?? max
  const targetRepsMax = max ?? min
  if (!Number.isInteger(targetRepsMin) || !Number.isInteger(targetRepsMax) ||
    targetRepsMin === null || targetRepsMax === null || targetRepsMin < 1 || targetRepsMax < 1) {
    throw new Error('目標次數須為至少 1 的整數')
  }
  if (targetRepsMin > targetRepsMax) throw new Error('目標次數下限不能大於上限')
  return { targetRepsMin, targetRepsMax }
}

export function formatTargetRange(min: number | null, max: number | null) {
  if (min === null || max === null) return ''
  return min === max ? `${min} 下` : `${min}～${max} 下`
}
