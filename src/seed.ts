import type { Routine, RoutineExercise } from './types'

function exercise(
  name: string,
  equipment = '',
  weight: number | null = null,
  reps: number | null = null,
  sets = 3,
  restSeconds = 90,
): RoutineExercise {
  return { id: crypto.randomUUID(), name, equipment, weight, reps, sets, restSeconds, note: '' }
}

export function makeInitialRoutines(): Routine[] {
  const updatedAt = new Date().toISOString()
  return [
    {
      id: 'push', name: 'Push day', label: '胸・肩・三頭', accent: '#d2f072', order: 0, updatedAt,
      exercises: [
        exercise('上斜胸推', '槓鈴', 30, 10, 4),
        exercise('平板臥推', '啞鈴', 20, 10, 3),
        exercise('肩推', '器械', 27, 10, 3),
        exercise('側平舉', 'Cable', 9, 15, 4),
        exercise('三頭屈伸', 'Cable', 23, 10, 4),
      ],
    },
    {
      id: 'pull', name: 'Pull day', label: '背・二頭', accent: '#85d7ef', order: 1, updatedAt,
      exercises: [
        exercise('上背划船', '寬握・器械', 32, 10, 4),
        exercise('背闊划船', '窄握・器械', 32, 10, 3),
        exercise('窄握下拉', 'Cable', 39, 10, 4),
        exercise('二頭彎舉', 'Cable', 32, 10, 3),
        exercise('錘式彎舉', 'Cable', 23, 10, 3),
      ],
    },
    {
      id: 'leg', name: 'Leg day', label: '腿・臀・核心', accent: '#ffb682', order: 2, updatedAt,
      exercises: [
        exercise('深蹲／腿推', '器械', 108, 10, 4, 120),
        exercise('髖鉸鏈／羅馬尼亞硬舉', '壺鈴', 20, 10, 3, 120),
        exercise('大腿內收', '器械', 36, 10, 3),
        exercise('腿彎舉', '器械', 32, 10, 3),
        exercise('小腿提踵'),
      ],
    },
    {
      id: 'upper', name: 'Upper', label: '上半身', accent: '#b8a7f6', order: 3, updatedAt,
      exercises: [
        exercise('啞鈴臥推'),
        exercise('寬距划船'),
        exercise('窄握下拉'),
        exercise('側平舉'),
        exercise('三頭下壓'),
        exercise('二頭彎舉'),
      ],
    },
    {
      id: 'lower', name: 'Lower', label: '下半身', accent: '#f19cbd', order: 4, updatedAt,
      exercises: [
        exercise('腿推'),
        exercise('臀推'),
        exercise('腿伸展'),
        exercise('腿後勾'),
        exercise('提踵'),
      ],
    },
  ]
}
