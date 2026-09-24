import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { liveQuery } from 'dexie'
import {
  Activity, ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, Check, CheckCircle2,
  ChevronLeft, ChevronRight, Clock3, Download, Dumbbell, FileDown, FileUp, Flame, History,
  House, LineChart, Minus, Pencil, Play, Plus, RotateCcw, Settings2,
  ShieldCheck, Timer, Trash2, X,
} from 'lucide-react'
import { db, exportBackup, exportCsv, importBackup, makeSession } from './db'
import type { AppSettings, Routine, RoutineExercise, SessionExercise, SetLog, WorkoutSession } from './types'
import {
  completedSetCount, displayWeight, exerciseKey, formatDate, localDateKey, plannedSetCount,
  weightToKg,
} from './utils'

type Screen = 'home' | 'routine' | 'workout' | 'history' | 'progress' | 'settings'

const blankSettings: AppSettings = { id: 'main', unit: 'kg', restTimerEnabled: true }

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [routines, setRoutines] = useState<Routine[]>([])
  const [sessions, setSessions] = useState<WorkoutSession[]>([])
  const [settings, setSettings] = useState<AppSettings>(blankSettings)
  const [selectedRoutineId, setSelectedRoutineId] = useState<string | null>(null)
  const [editingRoutine, setEditingRoutine] = useState<Routine | null>(null)
  const [historyDetailId, setHistoryDetailId] = useState<string | null>(null)
  const [showAddExercise, setShowAddExercise] = useState(false)
  const [activeSession, setActiveSession] = useState<WorkoutSession | null>(null)
  const activeRef = useRef<WorkoutSession | null>(null)
  const writeQueue = useRef<Promise<unknown>>(Promise.resolve())
  const importInput = useRef<HTMLInputElement>(null)
  const [toast, setToast] = useState('')
  const [now, setNow] = useState(Date.now())
  const [persisted, setPersisted] = useState<boolean | null>(null)

  useEffect(() => {
    const subscriptions = [
      liveQuery(() => db.routines.orderBy('order').toArray()).subscribe({ next: setRoutines, error: () => setToast('無法讀取菜單') }),
      liveQuery(() => db.sessions.orderBy('startedAt').reverse().toArray()).subscribe({ next: setSessions, error: () => setToast('無法讀取訓練紀錄') }),
      liveQuery(() => db.settings.get('main')).subscribe({ next: (value) => value && setSettings(value), error: () => setToast('無法讀取設定') }),
    ]
    let cancelled = false
    void db.sessions.where('status').equals('active').first().then((session) => {
      if (!cancelled && session) {
        activeRef.current = session
        setActiveSession(session)
      }
    })
    return () => { cancelled = true; subscriptions.forEach((subscription) => subscription.unsubscribe()) }
  }, [])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(''), 3600)
    return () => window.clearTimeout(timeout)
  }, [toast])

  useEffect(() => {
    if (!activeSession) return
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [activeSession?.id])

  useEffect(() => {
    if (screen !== 'settings' || !navigator.storage?.persisted) return
    void navigator.storage.persisted().then(setPersisted)
  }, [screen])

  const completed = useMemo(() => sessions.filter((session) => session.status === 'completed'), [sessions])
  const selectedRoutine = routines.find((routine) => routine.id === selectedRoutineId)
  const historyDetail = sessions.find((session) => session.id === historyDetailId)
  const currentWeekCount = completed.filter((session) => Date.now() - new Date(session.startedAt).getTime() < 7 * 86400000).length
  const restRemaining = activeSession?.restEndsAt ? Math.max(0, Math.ceil((activeSession.restEndsAt - now) / 1000)) : 0

  function updateSession(updater: (session: WorkoutSession) => WorkoutSession) {
    if (!activeRef.current) return
    const next = updater(activeRef.current)
    activeRef.current = next
    setActiveSession(next)
    writeQueue.current = writeQueue.current.catch(() => undefined).then(() => db.sessions.put(next)).catch(() => {
      setToast('儲存失敗，請先匯出備份並重新整理')
    })
  }

  async function startRoutine(routine: Routine) {
    if (activeRef.current) {
      setScreen('workout')
      setToast('先完成目前的訓練，再開始下一堂')
      return
    }
    const previous = completed.find((session) => session.routineId === routine.id)
    const next = makeSession(routine, previous)
    try {
      await db.sessions.put(next)
      activeRef.current = next
      setActiveSession(next)
      setScreen('workout')
      window.scrollTo(0, 0)
    } catch {
      setToast('無法建立訓練，請確認本機儲存空間')
    }
  }

  async function finishSession() {
    const current = activeRef.current
    if (!current) return
    if (completedSetCount(current) === 0 && !window.confirm('還沒有完成任何組。仍要結束訓練嗎？')) return
    const finished: WorkoutSession = { ...current, status: 'completed', endedAt: new Date().toISOString(), restEndsAt: null }
    try {
      await writeQueue.current
      await db.sessions.put(finished)
      activeRef.current = null
      setActiveSession(null)
      setScreen('history')
      setHistoryDetailId(finished.id)
      setToast('訓練已儲存')
    } catch {
      setToast('儲存失敗，請再試一次')
    }
  }

  async function discardSession() {
    const current = activeRef.current
    if (!current || !window.confirm('確定捨棄這次訓練？已輸入的組別會刪除。')) return
    await writeQueue.current
    await db.sessions.delete(current.id)
    activeRef.current = null
    setActiveSession(null)
    setScreen('home')
    setToast('已捨棄這次訓練')
  }

  function updateSet(exerciseId: string, setId: string, patch: Partial<SetLog>) {
    updateSession((current) => ({
      ...current,
      exercises: current.exercises.map((exercise) => exercise.id !== exerciseId ? exercise : {
        ...exercise,
        sets: exercise.sets.map((set) => set.id === setId ? { ...set, ...patch } : set),
      }),
    }))
  }

  function toggleSet(exercise: SessionExercise, set: SetLog) {
    const done = !set.done
    updateSession((current) => ({
      ...current,
      restEndsAt: done && settings.restTimerEnabled ? Date.now() + exercise.restSeconds * 1000 : current.restEndsAt,
      exercises: current.exercises.map((item) => item.id !== exercise.id ? item : {
        ...item,
        sets: item.sets.map((row) => row.id === set.id ? { ...row, done } : row),
      }),
    }))
    setNow(Date.now())
  }

  function addSet(exerciseId: string) {
    updateSession((current) => ({
      ...current,
      exercises: current.exercises.map((exercise) => {
        if (exercise.id !== exerciseId) return exercise
        const last = exercise.sets.at(-1)
        return {
          ...exercise,
          sets: [...exercise.sets, {
            id: crypto.randomUUID(), weight: last?.weight ?? null, reps: last?.reps ?? null,
            done: false, kind: 'working' as const,
          }],
        }
      }),
    }))
  }

  function removeSet(exerciseId: string, setId: string) {
    updateSession((current) => ({
      ...current,
      exercises: current.exercises.map((exercise) => exercise.id !== exerciseId ? exercise : {
        ...exercise, sets: exercise.sets.filter((set) => set.id !== setId),
      }),
    }))
  }

  function addWorkoutExercise(exercise: RoutineExercise) {
    updateSession((current) => ({
      ...current,
      exercises: [...current.exercises, {
        id: crypto.randomUUID(), sourceExerciseId: exercise.id, name: exercise.name,
        equipment: exercise.equipment, note: exercise.note, restSeconds: exercise.restSeconds,
        sets: Array.from({ length: exercise.sets }, () => ({
          id: crypto.randomUUID(), weight: exercise.weight, reps: exercise.reps,
          done: false, kind: 'working' as const,
        })),
      }],
    }))
    setShowAddExercise(false)
  }

  async function saveRoutine(routine: Routine) {
    if (!routine.name.trim()) { setToast('請輸入菜單名稱'); return }
    if (routine.exercises.some((exercise) => !exercise.name.trim())) { setToast('請填寫所有動作名稱'); return }
    const next = { ...routine, name: routine.name.trim(), updatedAt: new Date().toISOString() }
    await db.routines.put(next)
    setSelectedRoutineId(next.id)
    setEditingRoutine(null)
    setScreen('routine')
    setToast('菜單已儲存')
  }

  async function deleteRoutine(routine: Routine) {
    if (!window.confirm(`確定刪除「${routine.name}」菜單？過去的訓練紀錄會保留。`)) return
    await db.routines.delete(routine.id)
    setSelectedRoutineId(null)
    setScreen('home')
    setToast('菜單已刪除')
  }

  async function deleteHistory(session: WorkoutSession) {
    if (!window.confirm('確定刪除這次訓練紀錄？')) return
    await db.sessions.delete(session.id)
    setHistoryDetailId(null)
    setToast('紀錄已刪除')
  }

  async function changeSettings(patch: Partial<AppSettings>) {
    await db.settings.put({ ...settings, ...patch })
  }

  async function handleImport(file: File) {
    if (!window.confirm('匯入備份會取代目前所有菜單和訓練紀錄。確定繼續嗎？')) return
    try {
      await importBackup(file)
      const resumed = await db.sessions.where('status').equals('active').first() ?? null
      activeRef.current = resumed
      setActiveSession(resumed)
      setScreen('home')
      setToast('備份已還原')
    } catch (error) {
      setToast(error instanceof Error ? error.message : '無法匯入備份')
    } finally {
      if (importInput.current) importInput.current.value = ''
    }
  }

  return (
    <div className="app-shell">
      {screen === 'home' && <HomeScreen
        routines={routines} sessions={completed} activeSession={activeSession}
        currentWeekCount={currentWeekCount} onOpenRoutine={(id) => { setSelectedRoutineId(id); setScreen('routine') }}
        onResume={() => setScreen('workout')}
        onAddRoutine={() => setEditingRoutine({
          id: crypto.randomUUID(), name: '', label: '自訂訓練', accent: '#d2f072', order: routines.length,
          exercises: [], updatedAt: new Date().toISOString(),
        })}
      />}
      {screen === 'routine' && selectedRoutine && <RoutineScreen
        routine={selectedRoutine} unit={settings.unit} sessions={completed}
        onBack={() => setScreen('home')} onStart={() => void startRoutine(selectedRoutine)}
        onEdit={() => setEditingRoutine(selectedRoutine)} onDelete={() => void deleteRoutine(selectedRoutine)}
      />}
      {screen === 'workout' && activeSession && <WorkoutScreen
        session={activeSession} unit={settings.unit} restRemaining={restRemaining} now={now}
        onBack={() => setScreen('home')} onFinish={() => void finishSession()}
        onDiscard={() => void discardSession()}
        onUpdateSet={updateSet} onToggleSet={toggleSet} onAddSet={addSet} onRemoveSet={removeSet}
        onAddExercise={() => setShowAddExercise(true)}
        onDismissTimer={() => updateSession((current) => ({ ...current, restEndsAt: null }))}
      />}
      {screen === 'history' && <HistoryScreen sessions={completed} onOpen={setHistoryDetailId} />}
      {screen === 'progress' && <ProgressScreen sessions={completed} unit={settings.unit} />}
      {screen === 'settings' && <SettingsScreen
        settings={settings} persisted={persisted} onChange={(patch) => void changeSettings(patch)}
        onExport={() => void exportBackup()} onExportCsv={() => void exportCsv()}
        onImport={() => importInput.current?.click()}
        onRequestPersistence={async () => {
          if (!navigator.storage?.persist) { setToast('此瀏覽器不支援持久儲存設定'); return }
          const result = await navigator.storage.persist()
          setPersisted(result)
          setToast(result ? '已加強本機資料保存' : '瀏覽器未啟用持久儲存，請定期匯出備份')
        }}
      />}
      {!['routine', 'workout'].includes(screen) && <BottomNav screen={screen} onChange={setScreen} />}
      {editingRoutine && <RoutineEditor
        routine={editingRoutine} unit={settings.unit} onClose={() => setEditingRoutine(null)}
        onSave={(routine) => void saveRoutine(routine)}
      />}
      {showAddExercise && <AddExerciseModal
        unit={settings.unit} onClose={() => setShowAddExercise(false)} onAdd={addWorkoutExercise}
      />}
      {historyDetail && <HistoryDetail
        session={historyDetail} unit={settings.unit} onClose={() => setHistoryDetailId(null)}
        onDelete={() => void deleteHistory(historyDetail)}
      />}
      <input ref={importInput} className="visually-hidden" type="file" accept="application/json,.json"
        onChange={(event) => event.target.files?.[0] && void handleImport(event.target.files[0])} />
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}

function BrandHeader({ eyebrow }: { eyebrow?: string }) {
  return <header className="brand-header">
    <div className="brand-lockup"><span className="brand-mark"><Dumbbell size={19} strokeWidth={2.7} /></span>
      <span className="brand-name">GYM<span>RECORD</span></span></div>
    <span className="header-status"><span className="status-dot" />{eyebrow ?? '本機紀錄'}</span>
  </header>
}

function HomeScreen({ routines, sessions, activeSession, currentWeekCount, onOpenRoutine, onResume, onAddRoutine }: {
  routines: Routine[]
  sessions: WorkoutSession[]
  activeSession: WorkoutSession | null
  currentWeekCount: number
  onOpenRoutine: (id: string) => void
  onResume: () => void
  onAddRoutine: () => void
}) {
  const recent = sessions[0]
  return <main className="page page-with-nav">
    <div className="content-wrap">
      <BrandHeader />
      <section className="hero-card">
        <div className="hero-glow" />
        <div className="hero-copy">
          <span className="eyebrow hero-eyebrow"><span className="eyebrow-line" /> KEEP SHOWING UP</span>
          <h1>每一組，<br /><em>都算數。</em></h1>
          <p>把今天練的重量，變成明天的進步。</p>
        </div>
        <div className="hero-illustration"><div className="hero-ring ring-one" /><div className="hero-ring ring-two" /><Dumbbell size={118} strokeWidth={1.15} /></div>
        <span className="hero-index">01 / 05</span>
      </section>

      {activeSession && <button className="resume-card" onClick={onResume}>
        <span className="resume-icon"><Play size={17} fill="currentColor" /></span>
        <span><strong>繼續訓練</strong><small>{activeSession.routineName} · {completedSetCount(activeSession)} / {plannedSetCount(activeSession)} 組完成</small></span>
        <ArrowRight size={20} />
      </button>}

      <div className="overview-grid">
        <div className="overview-card"><span className="overview-icon"><Flame size={18} /></span><span className="overview-value">{currentWeekCount.toString().padStart(2, '0')}</span><span className="overview-label">近 7 天訓練</span></div>
        <div className="overview-card"><span className="overview-icon"><Activity size={18} /></span><span className="overview-value">{sessions.length.toString().padStart(2, '0')}</span><span className="overview-label">累積訓練次數</span></div>
        <div className="overview-card overview-last"><span className="overview-icon"><CalendarDays size={18} /></span><span className="overview-last-value">{recent ? formatDate(recent.startedAt, { month: 'numeric', day: 'numeric' }) : '—'}</span><span className="overview-label">上次訓練</span></div>
      </div>

      <div className="section-heading"><div><span className="eyebrow">YOUR ROUTINES</span><h2>選擇訓練日</h2></div>
        <button className="text-action" onClick={onAddRoutine}><Plus size={17} /> 新增菜單</button></div>
      <div className="routine-grid">
        {routines.map((routine, index) => {
          const last = sessions.find((session) => session.routineId === routine.id)
          return <button key={routine.id} className="routine-card" style={{ '--accent': routine.accent } as CSSProperties} onClick={() => onOpenRoutine(routine.id)}>
            <div className="routine-card-top"><span className="routine-number">{String(index + 1).padStart(2, '0')}</span><span className="routine-arrow"><ArrowUpRight size={20} /></span></div>
            <div><h3>{routine.name}</h3><p>{routine.label}</p></div>
            <div className="routine-card-bottom"><span><Dumbbell size={15} /> {routine.exercises.length} 個動作</span><span>{last ? formatDate(last.startedAt, { month: 'numeric', day: 'numeric' }) + ' 上次訓練' : '尚無紀錄'}</span></div>
          </button>
        })}
      </div>
      <p className="seed-note"><ShieldCheck size={15} /> 已參考你的筆記建立初始菜單，所有內容都可以修改。</p>
    </div>
  </main>
}

function RoutineScreen({ routine, unit, sessions, onBack, onStart, onEdit, onDelete }: {
  routine: Routine
  unit: AppSettings['unit']
  sessions: WorkoutSession[]
  onBack: () => void
  onStart: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const last = sessions.find((session) => session.routineId === routine.id)
  return <main className="page detail-page" style={{ '--accent': routine.accent } as CSSProperties}>
    <div className="content-wrap">
      <header className="detail-topbar"><button className="icon-button" onClick={onBack} aria-label="返回"><ArrowLeft size={22} /></button>
        <span className="topbar-title">訓練菜單</span><button className="icon-button" onClick={onEdit} aria-label="編輯菜單"><Pencil size={19} /></button></header>
      <div className="routine-title-area"><span className="eyebrow"><span className="eyebrow-line" /> YOUR ROUTINE</span><h1>{routine.name}</h1><p>{routine.label} <span className="middle-dot">·</span> {routine.exercises.length} 個動作</p></div>
      <div className="last-session-panel"><span className="last-session-icon"><RotateCcw size={18} /></span>
        <span><strong>上次訓練</strong><small>{last ? formatDate(last.startedAt) : '完成第一堂訓練後，這裡會顯示紀錄'}</small></span></div>
      <div className="section-heading compact"><div><span className="eyebrow">EXERCISE LIST</span><h2>動作安排</h2></div><span className="count-chip">{routine.exercises.length} 個</span></div>
      <div className="exercise-list">
        {routine.exercises.map((exercise, index) => <div className="exercise-list-item" key={exercise.id}>
          <span className="exercise-list-number">{String(index + 1).padStart(2, '0')}</span>
          <div className="exercise-list-main"><strong>{exercise.name}</strong><small>{exercise.equipment || '未設定器材'}{exercise.note && ` · ${exercise.note}`}</small></div>
          <div className="exercise-list-target"><strong>{exercise.weight === null ? '—' : `${displayWeight(exercise.weight, unit)} ${unit}`}</strong><small>{exercise.reps ?? '—'} 下 × {exercise.sets} 組</small></div>
        </div>)}
        {routine.exercises.length === 0 && <div className="empty-inline">這份菜單還沒有動作。點右上角編輯開始加入。</div>}
      </div>
      <button className="quiet-delete" onClick={onDelete}><Trash2 size={15} /> 刪除這份菜單</button>
    </div>
    <div className="sticky-action"><div className="sticky-action-inner"><button className="primary-button" onClick={onStart} disabled={routine.exercises.length === 0}><Play size={18} fill="currentColor" /> 開始訓練 <ArrowRight size={19} /></button></div></div>
  </main>
}

function WorkoutScreen({ session, unit, restRemaining, now, onBack, onFinish, onDiscard, onUpdateSet, onToggleSet, onAddSet, onRemoveSet, onAddExercise, onDismissTimer }: {
  session: WorkoutSession
  unit: AppSettings['unit']
  restRemaining: number
  now: number
  onBack: () => void
  onFinish: () => void
  onDiscard: () => void
  onUpdateSet: (exerciseId: string, setId: string, patch: Partial<SetLog>) => void
  onToggleSet: (exercise: SessionExercise, set: SetLog) => void
  onAddSet: (exerciseId: string) => void
  onRemoveSet: (exerciseId: string, setId: string) => void
  onAddExercise: () => void
  onDismissTimer: () => void
}) {
  const completed = completedSetCount(session)
  const planned = plannedSetCount(session)
  const elapsed = Math.max(0, Math.floor((now - new Date(session.startedAt).getTime()) / 60000))
  return <main className="page workout-page">
    <div className="content-wrap">
      <header className="detail-topbar"><button className="icon-button" onClick={onBack} aria-label="返回首頁"><ArrowLeft size={22} /></button>
        <span className="topbar-title"><span className="live-dot" /> 訓練進行中</span>
        <button className="topbar-link" onClick={onFinish}>完成</button></header>
      <div className="workout-heading"><div><span className="eyebrow">TODAY'S SESSION</span><h1>{session.routineName}</h1><p>{formatDate(session.startedAt)} <span className="middle-dot">·</span> 已訓練 {elapsed} 分鐘</p></div>
        <div className="workout-ring"><span>{completed}<small>/{planned}</small></span><svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="34" /><circle className="ring-fill" cx="40" cy="40" r="34" style={{ strokeDasharray: `${planned ? completed / planned * 214 : 0} 214` }} /></svg></div></div>
      <div className="workout-progress-track"><span style={{ width: `${planned ? completed / planned * 100 : 0}%` }} /></div>
      <p className="workout-progress-caption">已完成 {completed} / {planned} 組 <span>每完成一組，紀錄會自動儲存</span></p>

      {restRemaining > 0 && <div className="rest-banner"><span className="rest-icon"><Timer size={21} /></span><span><strong>休息計時</strong><small>準備好就繼續下一組</small></span><b>{String(Math.floor(restRemaining / 60)).padStart(2, '0')}:{String(restRemaining % 60).padStart(2, '0')}</b><button onClick={onDismissTimer} aria-label="結束計時"><X size={19} /></button></div>}

      <div className="workout-exercises">
        {session.exercises.map((exercise, exerciseIndex) => {
          const done = exercise.sets.filter((set) => set.done).length
          return <section className="workout-exercise-card" key={exercise.id}>
            <div className="workout-exercise-head"><span className="workout-exercise-index">{String(exerciseIndex + 1).padStart(2, '0')}</span><div><h2>{exercise.name}</h2><p>{exercise.equipment || '未設定器材'}{exercise.note && ` · ${exercise.note}`}</p></div><span className="set-count">{done}/{exercise.sets.length}</span></div>
            <div className="set-table-header"><span>組別</span><span>重量 <small>{unit}</small></span><span>次數</span><span>完成</span><span /></div>
            <div className="set-table-body">{exercise.sets.map((set, index) => <div className={`set-row ${set.done ? 'is-done' : ''}`} key={set.id}>
              <button className={`set-kind ${set.kind === 'warmup' ? 'is-warmup' : ''}`} title="點擊切換暖身／正式組" onClick={() => onUpdateSet(exercise.id, set.id, { kind: set.kind === 'warmup' ? 'working' : 'warmup' })}><b>{index + 1}</b><small>{set.kind === 'warmup' ? '暖身' : '正式'}</small></button>
              <NumberInput ariaLabel={`${exercise.name} 第 ${index + 1} 組重量`} value={displayWeight(set.weight, unit)} placeholder="—" onChange={(value) => onUpdateSet(exercise.id, set.id, { weight: weightToKg(value, unit) })} />
              <NumberInput ariaLabel={`${exercise.name} 第 ${index + 1} 組次數`} value={set.reps === null ? '' : String(set.reps)} placeholder="—" integer onChange={(value) => onUpdateSet(exercise.id, set.id, { reps: value })} />
              <button className={`set-check ${set.done ? 'checked' : ''}`} onClick={() => onToggleSet(exercise, set)} aria-label={set.done ? '取消完成' : '完成這組'}><Check size={20} strokeWidth={3} /></button>
              <button className="remove-set" onClick={() => onRemoveSet(exercise.id, set.id)} aria-label="刪除這組"><Minus size={15} /></button>
            </div>)}</div>
            <button className="add-set-button" onClick={() => onAddSet(exercise.id)}><Plus size={16} /> 加一組</button>
          </section>
        })}
      </div>
      <button className="add-exercise-button" onClick={onAddExercise}><Plus size={19} /> 加入動作</button>
      <button className="quiet-delete workout-discard" onClick={onDiscard}><Trash2 size={15} /> 捨棄這次訓練</button>
    </div>
    <div className="sticky-action"><div className="sticky-action-inner"><button className="primary-button" onClick={onFinish}><CheckCircle2 size={20} /> 結束並儲存訓練 <ArrowRight size={19} /></button></div></div>
  </main>
}

function HistoryScreen({ sessions, onOpen }: {
  sessions: WorkoutSession[]
  onOpen: (id: string) => void
}) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const year = month.getFullYear()
  const monthIndex = month.getMonth()
  const monthSessions = sessions.filter((session) => {
    const date = new Date(session.startedAt)
    return date.getFullYear() === year && date.getMonth() === monthIndex
  })
  const trainedDays = new Set(monthSessions.filter((session) => completedSetCount(session) > 0).map((session) => localDateKey(session.startedAt)))
  const visibleSessions = selectedDay ? monthSessions.filter((session) => localDateKey(session.startedAt) === selectedDay) : monthSessions
  const leadingDays = (month.getDay() + 6) % 7
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
  const totalSets = sessions.reduce((sum, session) => sum + completedSetCount(session), 0)
  function changeMonth(offset: number) {
    setMonth(new Date(year, monthIndex + offset, 1))
    setSelectedDay(null)
  }
  return <main className="page page-with-nav"><div className="content-wrap">
    <BrandHeader eyebrow="訓練檔案" />
    <div className="page-title"><span className="eyebrow">YOUR JOURNEY</span><h1>訓練紀錄<span className="title-dot">.</span></h1><p>每一次完成，都有跡可循。</p></div>
    <div className="history-summary"><div><span>累積訓練</span><strong>{sessions.length}<small>次</small></strong></div><div><span>完成組數</span><strong>{totalSets}<small>組</small></strong></div><div className="history-summary-icon"><History size={33} strokeWidth={1.5} /></div></div>
    <section className="calendar-card" aria-label="訓練日曆">
      <div className="calendar-header"><div><span className="eyebrow">TRAINING CALENDAR</span><h2>{year} 年 {monthIndex + 1} 月</h2></div><div className="calendar-controls"><button onClick={() => changeMonth(-1)} aria-label="上個月"><ChevronLeft size={19} /></button><button onClick={() => changeMonth(1)} aria-label="下個月"><ChevronRight size={19} /></button></div></div>
      <div className="calendar-month-count"><span className="calendar-count-dot" />本月訓練 <strong>{trainedDays.size}</strong> 天</div>
      <div className="calendar-grid">
        {['一', '二', '三', '四', '五', '六', '日'].map((day) => <span className="calendar-weekday" key={day}>{day}</span>)}
        {Array.from({ length: leadingDays }, (_, index) => <span className="calendar-spacer" key={`blank-${index}`} />)}
        {Array.from({ length: daysInMonth }, (_, index) => {
          const day = index + 1
          const key = localDateKey(new Date(year, monthIndex, day))
          const trained = trainedDays.has(key)
          return <button key={key} className={`calendar-day${trained ? ' trained' : ''}${selectedDay === key ? ' selected' : ''}${key === localDateKey(new Date()) ? ' today' : ''}`} onClick={() => setSelectedDay(selectedDay === key ? null : key)} aria-label={`${monthIndex + 1} 月 ${day} 日${trained ? '，有訓練' : '，無訓練'}`} aria-pressed={selectedDay === key}><span>{day}</span>{trained && <i aria-hidden="true" />}</button>
        })}
      </div>
    </section>
    <div className="section-heading compact"><div><span className="eyebrow">WORKOUT LOG</span><h2>{selectedDay ? `${monthIndex + 1} 月 ${Number(selectedDay.slice(-2))} 日` : '本月紀錄'}</h2></div><span className="count-chip">{visibleSessions.length} 筆</span></div>
    {visibleSessions.length === 0 ? <EmptyState icon={<CalendarDays size={32} />} title={selectedDay ? '這天沒有訓練紀錄' : '這個月還沒有訓練紀錄'} description="完成訓練後，可以在日曆選擇日期查看重量與組數。" /> :
      <div className="history-list">{visibleSessions.map((session) => <button className="history-card" key={session.id} onClick={() => onOpen(session.id)}>
        <div className="history-date"><strong>{new Date(session.startedAt).getDate().toString().padStart(2, '0')}</strong><small>{new Intl.DateTimeFormat('en', { month: 'short' }).format(new Date(session.startedAt)).toUpperCase()}</small></div>
        <div className="history-card-main"><strong>{session.routineName}</strong><small>{session.exercises.length} 個動作 <span>·</span> {completedSetCount(session)} 組完成</small></div>
        <div className="history-card-end"><ChevronRight size={18} /></div>
      </button>)}</div>}
  </div></main>
}

function ProgressScreen({ sessions, unit }: { sessions: WorkoutSession[], unit: AppSettings['unit'] }) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const records = useMemo(() => {
    const map = new Map<string, { key: string, name: string, equipment: string, points: { date: string, max: number }[] }>()
    for (const session of [...sessions].reverse()) {
      for (const exercise of session.exercises) {
        const done = exercise.sets.filter((set) => set.done && set.kind === 'working' && set.weight !== null)
        if (done.length === 0) continue
        const key = exerciseKey(exercise.name, exercise.equipment)
        const current = map.get(key) ?? { key, name: exercise.name, equipment: exercise.equipment, points: [] }
        current.points.push({
          date: session.startedAt,
          max: Math.max(...done.map((set) => set.weight ?? 0)),
        })
        map.set(key, current)
      }
    }
    return [...map.values()].sort((a, b) => b.points.length - a.points.length || a.name.localeCompare(b.name, 'zh-TW'))
  }, [sessions])
  const chosen = records.find((record) => record.key === selectedKey) ?? records[0]
  const current = chosen?.points.at(-1)
  const best = chosen ? Math.max(...chosen.points.map((point) => point.max)) : 0
  const converter = unit === 'lb' ? 2.2046226218 : 1
  return <main className="page page-with-nav"><div className="content-wrap">
    <BrandHeader eyebrow="數據趨勢" />
    <div className="page-title"><span className="eyebrow">GET STRONGER</span><h1>進步軌跡<span className="title-dot">.</span></h1><p>讓重量替你說話。</p></div>
    {records.length === 0 ? <EmptyState icon={<LineChart size={34} />} title="進步正在累積" description="完成訓練並勾選組別後，這裡會顯示每個動作的重量變化。" /> : <>
      <div className="section-heading compact"><div><span className="eyebrow">EXERCISE</span><h2>選擇動作</h2></div></div>
      <div className="exercise-picker">{records.map((record) => <button key={record.key} className={chosen?.key === record.key ? 'selected' : ''} onClick={() => setSelectedKey(record.key)}>{record.name}</button>)}</div>
      {chosen && <>
        <div className="progress-main-card"><div className="progress-main-header"><span><span className="eyebrow">MAX WEIGHT</span><h2>{chosen.name}</h2><small>{chosen.equipment || '自訂動作'} · {chosen.points.length} 次訓練</small></span><span className="progress-icon"><Dumbbell size={24} /></span></div>
          <div className="progress-big-number">{Math.round(best * converter * 10) / 10}<span>{unit}</span></div><span className="progress-big-label">最高完成重量</span>
          <ProgressChart values={chosen.points.map((point) => point.max * converter)} />
          <div className="chart-labels"><span>{formatDate(chosen.points[0].date, { month: 'numeric', day: 'numeric' })}</span><span>{formatDate(chosen.points.at(-1)!.date, { month: 'numeric', day: 'numeric' })}</span></div>
        </div>
        <div className="progress-stat-grid"><div className="progress-stat"><span>最近一次最高重量</span><strong>{Math.round((current?.max ?? 0) * converter * 10) / 10}<small> {unit}</small></strong></div></div>
        <div className="section-heading compact"><div><span className="eyebrow">HISTORY</span><h2>歷次表現</h2></div></div>
        <div className="progress-history">{[...chosen.points].reverse().map((point, index) => <div key={`${point.date}-${index}`}><span>{formatDate(point.date, { year: 'numeric', month: 'numeric', day: 'numeric' })}</span><strong>{Math.round(point.max * converter * 10) / 10} {unit}</strong></div>)}</div>
      </>}
    </>}
  </div></main>
}

function ProgressChart({ values }: { values: number[] }) {
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const points = values.map((value, index) => {
    const x = values.length === 1 ? 150 : 15 + index / (values.length - 1) * 270
    const y = maximum === minimum ? 65 : 108 - (value - minimum) / (maximum - minimum) * 85
    return { x, y }
  })
  const line = points.map((point) => `${point.x},${point.y}`).join(' ')
  const area = `15,120 ${line} 285,120`
  return <svg className="progress-chart" viewBox="0 0 300 128" preserveAspectRatio="none" role="img" aria-label="歷次最高重量趨勢">
    <defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#d2f072" stopOpacity=".22" /><stop offset="1" stopColor="#d2f072" stopOpacity="0" /></linearGradient></defs>
    <path d="M0 108H300 M0 65H300 M0 23H300" className="chart-grid" />
    {points.length > 1 && <polygon points={area} fill="url(#chartFill)" />}
    {points.length > 1 && <polyline points={line} fill="none" stroke="#d2f072" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
    {points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="4.7" fill="#d2f072" stroke="#162015" strokeWidth="3" />)}
  </svg>
}

function SettingsScreen({ settings, persisted, onChange, onExport, onExportCsv, onImport, onRequestPersistence }: {
  settings: AppSettings
  persisted: boolean | null
  onChange: (patch: Partial<AppSettings>) => void
  onExport: () => void
  onExportCsv: () => void
  onImport: () => void
  onRequestPersistence: () => void
}) {
  return <main className="page page-with-nav"><div className="content-wrap">
    <BrandHeader eyebrow="個人設定" />
    <div className="page-title"><span className="eyebrow">MAKE IT YOURS</span><h1>設定<span className="title-dot">.</span></h1><p>掌握自己的訓練方式與資料。</p></div>
    <section className="settings-section"><div className="section-heading compact"><div><span className="eyebrow">PREFERENCES</span><h2>訓練偏好</h2></div></div>
      <div className="setting-card"><div className="setting-row"><span className="setting-icon"><Dumbbell size={19} /></span><span className="setting-copy"><strong>重量單位</strong><small>輸入與顯示的單位</small></span><div className="segmented"><button className={settings.unit === 'kg' ? 'active' : ''} onClick={() => onChange({ unit: 'kg' })}>kg</button><button className={settings.unit === 'lb' ? 'active' : ''} onClick={() => onChange({ unit: 'lb' })}>lb</button></div></div>
        <div className="setting-row"><span className="setting-icon"><Timer size={19} /></span><span className="setting-copy"><strong>組間休息計時</strong><small>完成一組後自動開始</small></span><button className={`toggle ${settings.restTimerEnabled ? 'on' : ''}`} role="switch" aria-checked={settings.restTimerEnabled} onClick={() => onChange({ restTimerEnabled: !settings.restTimerEnabled })}><span /></button></div>
      </div>
    </section>
    <section className="settings-section"><div className="section-heading compact"><div><span className="eyebrow">YOUR DATA</span><h2>資料管理</h2></div></div>
      <div className="setting-card">
        <button className="setting-row setting-button" onClick={onExport}><span className="setting-icon"><Download size={19} /></span><span className="setting-copy"><strong>匯出完整備份</strong><small>儲存為 JSON，可完整還原</small></span><ChevronRight size={18} /></button>
        <button className="setting-row setting-button" onClick={onImport}><span className="setting-icon"><FileUp size={19} /></span><span className="setting-copy"><strong>匯入備份</strong><small>從本機檔案還原資料</small></span><ChevronRight size={18} /></button>
        <button className="setting-row setting-button" onClick={onExportCsv}><span className="setting-icon"><FileDown size={19} /></span><span className="setting-copy"><strong>匯出 CSV 紀錄</strong><small>方便在試算表檢視</small></span><ChevronRight size={18} /></button>
      </div>
    </section>
    <section className="settings-section"><div className="section-heading compact"><div><span className="eyebrow">LOCAL FIRST</span><h2>本機保存</h2></div></div>
      <div className="local-card"><div className="local-card-icon"><ShieldCheck size={24} /></div><h3>你的資料留在這台裝置</h3><p>訓練內容儲存在瀏覽器本機資料庫。建議定期匯出備份，換裝置或清除瀏覽器資料時即可還原。</p>
        <button onClick={onRequestPersistence} disabled={persisted === true}><ShieldCheck size={17} /> {persisted ? '已啟用持久儲存' : '加強本機資料保存'}</button></div>
    </section>
    <p className="settings-footer">GYMRECORD · 讓每一次努力都有紀錄</p>
  </div></main>
}

function BottomNav({ screen, onChange }: { screen: Screen, onChange: (screen: Screen) => void }) {
  const items = [
    { key: 'home' as const, label: '訓練', icon: House },
    { key: 'history' as const, label: '紀錄', icon: History },
    { key: 'progress' as const, label: '進度', icon: LineChart },
    { key: 'settings' as const, label: '設定', icon: Settings2 },
  ]
  return <nav className="bottom-nav"><div className="bottom-nav-inner">{items.map((item) => <button key={item.key} className={screen === item.key ? 'active' : ''} onClick={() => { onChange(item.key); window.scrollTo(0, 0) }}><item.icon size={21} strokeWidth={screen === item.key ? 2.4 : 1.8} /><span>{item.label}</span></button>)}</div></nav>
}

function EmptyState({ icon, title, description }: { icon: ReactNode, title: string, description: string }) {
  return <div className="empty-state"><span className="empty-state-icon">{icon}</span><h3>{title}</h3><p>{description}</p></div>
}

function HistoryDetail({ session, unit, onClose, onDelete }: {
  session: WorkoutSession
  unit: AppSettings['unit']
  onClose: () => void
  onDelete: () => void
}) {
  const duration = session.endedAt ? Math.max(0, Math.round((new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 60000)) : 0
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="sheet detail-sheet" role="dialog" aria-modal="true" aria-label="訓練詳情">
      <div className="sheet-header"><div><span className="eyebrow">WORKOUT DETAIL</span><h2>{session.routineName}</h2></div><button className="icon-button" onClick={onClose} aria-label="關閉"><X size={21} /></button></div>
      <div className="sheet-scroll">
        <p className="sheet-date">{formatDate(session.startedAt, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</p>
        <div className="detail-stats"><div><Clock3 size={17} /><strong>{duration}</strong><span>分鐘</span></div><div><CheckCircle2 size={17} /><strong>{completedSetCount(session)}</strong><span>完成組數</span></div><div><Dumbbell size={17} /><strong>{session.exercises.length}</strong><span>訓練動作</span></div></div>
        <div className="detail-exercise-list">{session.exercises.map((exercise, index) => <section key={exercise.id} className="detail-exercise"><div className="detail-exercise-title"><span>{String(index + 1).padStart(2, '0')}</span><div><h3>{exercise.name}</h3><small>{exercise.equipment || '未設定器材'}</small></div></div>
          <div className="detail-set-list">{exercise.sets.map((set, setIndex) => <div key={set.id} className={set.done ? '' : 'muted'}><span>{set.kind === 'warmup' ? '暖身' : `第 ${setIndex + 1} 組`}</span><strong>{set.weight === null ? '—' : displayWeight(set.weight, unit)} {unit} <small>×</small> {set.reps ?? '—'} 下</strong>{set.done ? <Check size={16} /> : <Minus size={16} />}</div>)}</div>
        </section>)}</div>
        <button className="quiet-delete" onClick={onDelete}><Trash2 size={15} /> 刪除這筆紀錄</button>
      </div>
    </div>
  </div>
}

function RoutineEditor({ routine, unit, onClose, onSave }: {
  routine: Routine
  unit: AppSettings['unit']
  onClose: () => void
  onSave: (routine: Routine) => void
}) {
  const [draft, setDraft] = useState<Routine>(() => structuredClone(routine))
  function patchExercise(id: string, patch: Partial<RoutineExercise>) {
    setDraft((current) => ({ ...current, exercises: current.exercises.map((exercise) => exercise.id === id ? { ...exercise, ...patch } : exercise) }))
  }
  function moveExercise(index: number, direction: -1 | 1) {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= draft.exercises.length) return
    const next = [...draft.exercises]
    ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
    setDraft({ ...draft, exercises: next })
  }
  function addExercise() {
    setDraft((current) => ({ ...current, exercises: [...current.exercises, {
      id: crypto.randomUUID(), name: '', equipment: '', weight: null, reps: 10, sets: 3, restSeconds: 90, note: '',
    }] }))
  }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="sheet editor-sheet" role="dialog" aria-modal="true" aria-label="編輯訓練菜單">
      <div className="sheet-header"><div><span className="eyebrow">ROUTINE EDITOR</span><h2>{routine.name ? '編輯菜單' : '新增菜單'}</h2></div><button className="icon-button" onClick={onClose} aria-label="關閉"><X size={21} /></button></div>
      <div className="sheet-scroll editor-scroll">
        <div className="form-grid"><label className="form-field"><span>菜單名稱</span><input value={draft.name} placeholder="例如 Push day" onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label className="form-field"><span>訓練部位／描述</span><input value={draft.label} placeholder="例如 胸・肩・三頭" onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label></div>
        <div className="editor-section-heading"><div><span className="eyebrow">EXERCISES</span><h3>動作安排</h3></div><span>{draft.exercises.length} 個動作</span></div>
        <div className="editor-exercises">{draft.exercises.map((exercise, index) => <div className="editor-exercise" key={exercise.id}>
          <div className="editor-exercise-top"><span className="editor-index">{String(index + 1).padStart(2, '0')}</span><input aria-label="動作名稱" value={exercise.name} placeholder="動作名稱" onChange={(event) => patchExercise(exercise.id, { name: event.target.value })} /><button onClick={() => moveExercise(index, -1)} disabled={index === 0} aria-label="上移動作">↑</button><button onClick={() => moveExercise(index, 1)} disabled={index === draft.exercises.length - 1} aria-label="下移動作">↓</button><button onClick={() => setDraft({ ...draft, exercises: draft.exercises.filter((item) => item.id !== exercise.id) })} aria-label="刪除動作"><Trash2 size={16} /></button></div>
          <div className="editor-exercise-grid"><label className="form-field wide"><span>器材／變化</span><input value={exercise.equipment} placeholder="例如 槓鈴、Cable" onChange={(event) => patchExercise(exercise.id, { equipment: event.target.value })} /></label>
            <label className="form-field"><span>重量 {unit}</span><NumberInput value={displayWeight(exercise.weight, unit)} onChange={(value) => patchExercise(exercise.id, { weight: weightToKg(value, unit) })} placeholder="—" ariaLabel="預設重量" /></label>
            <label className="form-field"><span>次數</span><NumberInput value={exercise.reps === null ? '' : String(exercise.reps)} onChange={(value) => patchExercise(exercise.id, { reps: value })} placeholder="—" ariaLabel="預設次數" integer /></label>
            <label className="form-field"><span>組數</span><NumberInput value={String(exercise.sets)} onChange={(value) => patchExercise(exercise.id, { sets: Math.max(1, value ?? 1) })} placeholder="3" ariaLabel="預設組數" integer /></label>
            <label className="form-field"><span>休息 秒</span><NumberInput value={String(exercise.restSeconds)} onChange={(value) => patchExercise(exercise.id, { restSeconds: Math.max(0, value ?? 0) })} placeholder="90" ariaLabel="休息秒數" integer /></label>
            <label className="form-field full"><span>備註</span><input value={exercise.note} placeholder="例如 座椅高度、握法" onChange={(event) => patchExercise(exercise.id, { note: event.target.value })} /></label>
          </div>
        </div>)}</div>
        <button className="add-exercise-button" onClick={addExercise}><Plus size={18} /> 新增動作</button>
      </div>
      <div className="sheet-footer"><button className="primary-button" onClick={() => onSave(draft)}><Check size={19} /> 儲存菜單</button></div>
    </div>
  </div>
}

function AddExerciseModal({ unit, onClose, onAdd }: {
  unit: AppSettings['unit']
  onClose: () => void
  onAdd: (exercise: RoutineExercise) => void
}) {
  const [exercise, setExercise] = useState<RoutineExercise>({
    id: crypto.randomUUID(), name: '', equipment: '', weight: null, reps: 10, sets: 3, restSeconds: 90, note: '',
  })
  const patch = (value: Partial<RoutineExercise>) => setExercise((current) => ({ ...current, ...value }))
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="sheet small-sheet" role="dialog" aria-modal="true" aria-label="加入動作">
      <div className="sheet-header"><div><span className="eyebrow">ADD EXERCISE</span><h2>加入動作</h2></div><button className="icon-button" onClick={onClose} aria-label="關閉"><X size={21} /></button></div>
      <div className="sheet-scroll"><div className="form-grid"><label className="form-field"><span>動作名稱</span><input value={exercise.name} autoFocus placeholder="例如 上斜胸推" onChange={(event) => patch({ name: event.target.value })} /></label><label className="form-field"><span>器材／變化</span><input value={exercise.equipment} placeholder="例如 槓鈴" onChange={(event) => patch({ equipment: event.target.value })} /></label></div>
        <div className="quick-exercise-grid"><label className="form-field"><span>重量 {unit}</span><NumberInput value={displayWeight(exercise.weight, unit)} onChange={(value) => patch({ weight: weightToKg(value, unit) })} placeholder="—" ariaLabel="重量" /></label><label className="form-field"><span>次數</span><NumberInput value={exercise.reps === null ? '' : String(exercise.reps)} onChange={(value) => patch({ reps: value })} placeholder="10" ariaLabel="次數" integer /></label><label className="form-field"><span>組數</span><NumberInput value={String(exercise.sets)} onChange={(value) => patch({ sets: Math.max(1, value ?? 1) })} placeholder="3" ariaLabel="組數" integer /></label></div>
      </div>
      <div className="sheet-footer"><button className="primary-button" disabled={!exercise.name.trim()} onClick={() => onAdd({ ...exercise, name: exercise.name.trim() })}><Plus size={19} /> 加入訓練</button></div>
    </div>
  </div>
}

function NumberInput({ value, onChange, placeholder, ariaLabel, integer = false }: {
  value: string
  onChange: (value: number | null) => void
  placeholder: string
  ariaLabel: string
  integer?: boolean
}) {
  const [raw, setRaw] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setRaw(value)
  }, [value])
  return <input ref={inputRef} className="number-input" type="text" inputMode={integer ? 'numeric' : 'decimal'}
    aria-label={ariaLabel} value={raw} placeholder={placeholder}
    onChange={(event) => {
      const next = event.target.value.replace(',', '.')
      if (!/^\d*(?:\.\d*)?$/.test(next)) return
      setRaw(next)
      onChange(next === '' || next === '.' ? null : Number(next))
    }}
    onBlur={() => setRaw(value)} />
}
