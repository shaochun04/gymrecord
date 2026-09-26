import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  Activity, ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, Check, CheckCircle2,
  ChevronLeft, ChevronRight, Clock3, Download, Dumbbell, FileDown, FileUp, Flame, History,
  House, LineChart, Minus, Pencil, Play, Plus, RotateCcw, Settings2,
  ShieldCheck, Timer, Trash2, X,
} from 'lucide-react'
import { exportBackup, exportCsv, importPreparedBackup, prepareBackupImport } from './data/backup'
import { makeSession } from './data/session'
import type { WorkoutChangeSource } from './data/workoutChanges'
import { ActiveSessionExistsError, type WorkoutRepository } from './data/workoutRepository'
import type { AppSettings, ExerciseDefinition, Routine, RoutineExercise, SessionExercise, SetLog, WorkoutSession } from './types'
import { createId } from './id'
import { definitionSubtitle, MUSCLE_LABELS, newDefinition, normalizeExerciseText, variantSubtitle } from './exerciseDefinitions'
import { ExerciseDefinitionEditor, ExerciseLibrary, ExercisePicker } from './ExerciseLibrary'
import { shiftLocalWeek, startOfLocalWeek, weeklyMuscleStats } from './muscleStats'
import { cloneRoutine, exerciseVolumeSeries, moveSessionExercise, newSessionPrs, unfinishedSessionCounts, validateCompletedSessionEdit } from './phase4Logic'
import { formatTargetRange, normalizeTargetRange } from './targetReps'
import { initialScreenForActiveSession, makeAppHistoryState, readAppHistoryState } from './navigation'
import { ActiveSessionLease } from './sessionLease'
import {
  adjustReps, adjustWeightKg, calculateExercisePr, canChangeExerciseIdentity, changeExerciseVariant, completedWorkingVolumeKg, durationMinutes,
  exerciseIdentityKey, findExerciseHistory, findPreviousPerformance, formatRir, getProgressionSuggestion,
  formatDuration, nextRestEndAfterToggle, remainingRestSeconds, shiftRestEnd,
} from './workoutLogic'
import {
  completedSetCount, displayWeight, formatDate, localDateKey, plannedSetCount,
  weightToKg,
} from './utils'

type Screen = 'home' | 'routine' | 'workout' | 'summary' | 'history' | 'progress' | 'settings' | 'library'

const blankSettings: AppSettings = { id: 'main', unit: 'kg', restTimerEnabled: true }

export default function App({ repository, changes }: { repository: WorkoutRepository, changes: WorkoutChangeSource }) {
  const [screen, setScreen] = useState<Screen>('home')
  const [routines, setRoutines] = useState<Routine[]>([])
  const [definitions, setDefinitions] = useState<ExerciseDefinition[]>([])
  const [sessions, setSessions] = useState<WorkoutSession[]>([])
  const [settings, setSettings] = useState<AppSettings>(blankSettings)
  const [selectedRoutineId, setSelectedRoutineId] = useState<string | null>(null)
  const [editingRoutine, setEditingRoutine] = useState<Routine | null>(null)
  const [historyDetailId, setHistoryDetailId] = useState<string | null>(null)
  const [showAddExercise, setShowAddExercise] = useState(false)
  const [activeSession, setActiveSession] = useState<WorkoutSession | null>(null)
  const [summarySession, setSummarySession] = useState<WorkoutSession | null>(null)
  const activeRef = useRef<WorkoutSession | null>(null)
  const startingRef = useRef(false)
  const pendingSessionWrite = useRef<WorkoutSession | null>(null)
  const sessionSaveLoop = useRef<Promise<void> | null>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const [toast, setToast] = useState('')
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [sessionReadOnly, setSessionReadOnly] = useState(false)
  const readOnlyRef = useRef(false)
  const navigationReady = useRef(false)
  const applyingHistory = useRef(false)
  const routinesRef = useRef<Routine[]>([])
  const navigationModal = editingRoutine ? 'routine-editor' as const : showAddExercise ? 'add-exercise' as const : null
  const navigationEditingId = editingRoutine ? (routines.some((routine) => routine.id === editingRoutine.id) ? editingRoutine.id : 'new') : null

  useEffect(() => { routinesRef.current = routines }, [routines])
  useEffect(() => { readOnlyRef.current = sessionReadOnly }, [sessionReadOnly])

  useEffect(() => {
    if (!activeSession) { setSessionReadOnly(false); return }
    const lease = new ActiveSessionLease(activeSession.id, () => {
      setSessionReadOnly(true)
      setToast('這筆訓練已在另一個分頁編輯，本頁已切換為唯讀')
    })
    const acquired = lease.acquire()
    setSessionReadOnly(!acquired)
    if (!acquired) setToast('這筆訓練正在另一個分頁編輯，本頁僅供查看')
    return () => lease.release()
  }, [activeSession?.id])

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const location = readAppHistoryState(event.state)
      if (!location) return
      applyingHistory.current = true
      setScreen(location.screen as Screen)
      setSelectedRoutineId(location.selectedRoutineId)
      setHistoryDetailId(location.historyDetailId)
      setShowAddExercise(location.modal === 'add-exercise')
      setEditingRoutine(location.modal === 'routine-editor'
        ? location.editingRoutineId === 'new' ? { id: createId(), name: '', label: '自訂訓練', accent: '#d2f072', order: routinesRef.current.length, exercises: [], updatedAt: new Date().toISOString() }
          : routinesRef.current.find((routine) => routine.id === location.editingRoutineId) ?? null
        : null)
    }
    window.history.replaceState(makeAppHistoryState({ screen, selectedRoutineId, historyDetailId, modal: null, editingRoutineId: null }), '')
    navigationReady.current = true
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    if (!navigationReady.current) return
    if (applyingHistory.current) { applyingHistory.current = false; return }
    window.history.pushState(makeAppHistoryState({ screen, selectedRoutineId, historyDetailId, modal: navigationModal,
      editingRoutineId: navigationEditingId }), '')
  }, [screen, selectedRoutineId, historyDetailId, navigationModal, navigationEditingId])

  useEffect(() => {
    let cancelled = false
    const unsubscribe = changes.subscribe((change) => {
      if (change.kind === 'exerciseDefinitions') setDefinitions(change.value)
      if (change.kind === 'routines') setRoutines(change.value)
      if (change.kind === 'sessions') setSessions(change.value)
      if (change.kind === 'settings') setSettings(change.value)
    }, () => setToast('無法讀取訓練資料'))
    void repository.getActiveSession().then((session) => {
      if (!cancelled && session && !activeRef.current) {
        activeRef.current = session
        setActiveSession(session)
        setScreen(initialScreenForActiveSession(session))
      }
    }).catch((error) => setToast(error instanceof Error ? error.message : '無法讀取未完成訓練'))
    return () => { cancelled = true; unsubscribe() }
  }, [repository, changes])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(''), 3600)
    return () => window.clearTimeout(timeout)
  }, [toast])

  useEffect(() => {
    if (screen !== 'settings' || !navigator.storage?.persisted) return
    void navigator.storage.persisted().then(setPersisted)
  }, [screen])

  const completed = useMemo(() => sessions.filter((session) => session.status === 'completed'), [sessions])
  const selectedRoutine = routines.find((routine) => routine.id === selectedRoutineId)
  const historyDetail = sessions.find((session) => session.id === historyDetailId)
  const currentWeekCount = completed.filter((session) => Date.now() - new Date(session.startedAt).getTime() < 7 * 86400000).length

  function flushSessionWrites(): Promise<void> {
    if (sessionSaveLoop.current) return sessionSaveLoop.current
    let failed = false
    const run = async () => {
      while (pendingSessionWrite.current) {
        const next = pendingSessionWrite.current
        pendingSessionWrite.current = null
        try { await repository.saveSession(next) }
        catch (error) {
          if (!pendingSessionWrite.current) pendingSessionWrite.current = next
          failed = true
          throw error
        }
      }
    }
    sessionSaveLoop.current = run().finally(() => {
      sessionSaveLoop.current = null
      if (pendingSessionWrite.current && !failed) void flushSessionWrites().catch(() => setToast('儲存失敗，請先匯出備份並重新整理'))
    })
    return sessionSaveLoop.current
  }

  useEffect(() => {
    const flush = () => { if (activeRef.current) void flushSessionWrites().catch(() => setToast('儲存失敗，請先匯出備份並重新整理')) }
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)
    return () => { document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('pagehide', flush) }
  }, [repository])

  function updateSession(updater: (session: WorkoutSession) => WorkoutSession) {
    if (readOnlyRef.current) { setToast('另一個分頁正在編輯這筆訓練'); return }
    if (!activeRef.current) return
    const next = updater(activeRef.current)
    activeRef.current = next
    setActiveSession(next)
    pendingSessionWrite.current = next
    void flushSessionWrites().catch(() => setToast('儲存失敗，請先匯出備份並重新整理'))
  }

  async function startRoutine(routine: Routine) {
    if (startingRef.current) return
    if (activeRef.current) {
      setScreen('workout')
      setToast('先完成目前的訓練，再開始下一堂')
      return
    }
    startingRef.current = true
    try {
      const existing = await repository.getActiveSession()
      if (existing) {
        activeRef.current = existing
        setActiveSession(existing)
        setScreen('workout')
        setToast('先完成目前的訓練，再開始下一堂')
        return
      }
      const [previousSessions, currentDefinitions] = await Promise.all([repository.getSessions(), repository.getExerciseDefinitions()])
      const next = makeSession(routine, currentDefinitions, previousSessions)
      await repository.saveSession(next)
      activeRef.current = next
      setActiveSession(next)
      setScreen('workout')
      window.scrollTo(0, 0)
    } catch (error) {
      if (error instanceof ActiveSessionExistsError) {
        activeRef.current = error.activeSession
        setActiveSession(error.activeSession)
        setScreen('workout')
        setToast('先完成目前的訓練，再開始下一堂')
      } else {
        setToast(error instanceof Error ? error.message : '無法建立訓練，請確認本機儲存空間')
      }
    } finally {
      startingRef.current = false
    }
  }

  async function finishSession() {
    const current = activeRef.current
    if (!current) return
    const unfinished = unfinishedSessionCounts(current)
    const warnings = [unfinished.workingSets > 0 ? `尚有 ${unfinished.workingSets} 組正式組未完成` : '',
      unfinished.exercises > 0 ? `${unfinished.exercises} 個動作尚未完成` : ''].filter(Boolean)
    if (completedSetCount(current) === 0) warnings.unshift('還沒有完成任何組')
    if (warnings.length && !window.confirm(`${warnings.join('、')}，仍要結束訓練嗎？`)) return
    const finished: WorkoutSession = { ...current, status: 'completed', endedAt: new Date().toISOString(), restEndsAt: null }
    try {
      await flushSessionWrites()
      await repository.saveSession(finished)
      activeRef.current = null
      setActiveSession(null)
      setSummarySession(finished)
      setScreen('summary')
      window.scrollTo(0, 0)
      setToast('訓練已儲存')
    } catch {
      setToast('儲存失敗，請再試一次')
    }
  }

  async function discardSession() {
    const current = activeRef.current
    if (!current || !window.confirm('確定捨棄這次訓練？已輸入的組別會刪除。')) return
    await flushSessionWrites()
    await repository.deleteSession(current.id)
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
      restEndsAt: nextRestEndAfterToggle(set, settings.restTimerEnabled, exercise.restSeconds, Date.now(), current.restEndsAt),
      exercises: current.exercises.map((item) => item.id !== exercise.id ? item : {
        ...item,
        sets: item.sets.map((row) => row.id === set.id ? { ...row, done, rir: done ? row.rir : null } : row),
      }),
    }))
  }

  function addSet(exerciseId: string) {
    updateSession((current) => ({
      ...current,
      exercises: current.exercises.map((exercise) => {
        if (exercise.id !== exerciseId) return exercise
        const last = exercise.sets.at(-1)
        const source = routines.find((routine) => routine.id === current.routineId)?.exercises.find((item) =>
          item.id === exercise.sourceExerciseId,
        )
        return {
          ...exercise,
          sets: [...exercise.sets, {
            id: createId(), weight: last ? last.weight : source?.weight ?? null,
            reps: last ? last.reps : source?.reps ?? null,
            done: false, kind: 'working' as const, rir: null,
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

  function reorderSessionExercise(exerciseId: string, direction: -1 | 1) {
    updateSession((current) => moveSessionExercise(current, exerciseId, direction))
  }

  function updateExerciseIdentity(exerciseId: string, equipment: string, variation: string) {
    updateSession((current) => current.status !== 'active' ? current : ({ ...current,
      exercises: current.exercises.map((exercise) => exercise.id !== exerciseId ? exercise :
        changeExerciseVariant(exercise, equipment, variation, completed, current.id)) }))
  }

  function addWorkoutExercise(definition: ExerciseDefinition, exercise: RoutineExercise) {
    updateSession((current) => ({
      ...current,
      exercises: [...current.exercises, {
        id: createId(), sourceExerciseId: '', exerciseDefinitionId: definition.id,
        name: definition.name, equipment: normalizeExerciseText(exercise.defaultEquipment ?? ''),
        variation: normalizeExerciseText(exercise.defaultVariation ?? ''),
        note: exercise.note, restSeconds: exercise.restSeconds,
        targetRepsMin: exercise.targetRepsMin, targetRepsMax: exercise.targetRepsMax,
        sets: Array.from({ length: exercise.sets }, () => ({
          id: createId(), weight: exercise.weight, reps: exercise.reps,
          done: false, kind: 'working' as const, rir: null,
        })),
      }],
    }))
    setShowAddExercise(false)
  }

  async function saveRoutine(routine: Routine) {
    if (!routine.name.trim()) { setToast('請輸入菜單名稱'); return }
    const currentDefinitions = await repository.getExerciseDefinitions()
    if (routine.exercises.some((exercise) => !currentDefinitions.some((definition) => definition.id === exercise.exerciseDefinitionId))) {
      setToast('菜單中有找不到的動作，請重新選擇'); return
    }
    let exercises: RoutineExercise[]
    try {
      exercises = routine.exercises.map((exercise) => ({ ...exercise,
        defaultEquipment: normalizeExerciseText(exercise.defaultEquipment ?? '') || null,
        defaultVariation: normalizeExerciseText(exercise.defaultVariation ?? '') || null,
        ...normalizeTargetRange(exercise.targetRepsMin, exercise.targetRepsMax) }))
    } catch (error) {
      setToast(error instanceof Error ? error.message : '目標次數格式錯誤')
      return
    }
    const next = { ...routine, exercises, name: routine.name.trim(), updatedAt: new Date().toISOString() }
    await repository.saveRoutine(next)
    setSelectedRoutineId(next.id)
    setEditingRoutine(null)
    setScreen('routine')
    setToast('菜單已儲存')
  }

  async function duplicateRoutine(routine: Routine) {
    const next = cloneRoutine(routine, Math.max(-1, ...routines.map((item) => item.order)) + 1)
    try {
      await repository.saveRoutine(next)
      setSelectedRoutineId(next.id)
      setScreen('routine')
      setToast('菜單已複製')
    } catch { setToast('無法複製菜單，請再試一次') }
  }

  async function saveHistoryEdit(original: WorkoutSession, edited: WorkoutSession) {
    validateCompletedSessionEdit(original, edited)
    await repository.saveSession(edited)
    setToast('訓練紀錄已更新')
  }

  async function saveDefinition(definition: ExerciseDefinition) {
    await repository.saveExerciseDefinition(definition)
    setDefinitions((current) => current.some((item) => item.id === definition.id)
      ? current.map((item) => item.id === definition.id ? definition : item) : [...current, definition])
    setToast('動作已儲存')
  }

  async function archiveDefinition(id: string, archived: boolean) {
    await repository.archiveExerciseDefinition(id, archived)
    setToast(archived ? '動作已封存' : '動作已取消封存')
  }

  async function mergeDefinitions(sourceId: string, targetId: string) {
    await flushSessionWrites()
    const result = await repository.mergeExerciseDefinitions(sourceId, targetId)
    const resumed = await repository.getActiveSession()
    activeRef.current = resumed
    setActiveSession(resumed)
    setToast(`已合併 ${result.routines} 份菜單、${result.sessions} 筆訓練紀錄`)
  }

  async function deleteRoutine(routine: Routine) {
    if (!window.confirm(`確定刪除「${routine.name}」菜單？過去的訓練紀錄會保留。`)) return
    await repository.deleteRoutine(routine.id)
    setSelectedRoutineId(null)
    setScreen('home')
    setToast('菜單已刪除')
  }

  async function deleteHistory(session: WorkoutSession) {
    if (!window.confirm('確定刪除這次訓練紀錄？')) return
    await repository.deleteSession(session.id)
    setHistoryDetailId(null)
    setToast('紀錄已刪除')
  }

  async function changeSettings(patch: Partial<AppSettings>) {
    await repository.saveSettings({ ...settings, ...patch })
  }

  async function handleImport(file: File) {
    try {
      const prepared = await prepareBackupImport(file)
      const date = prepared.preview.exportedAt ? formatDate(prepared.preview.exportedAt, { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '未提供'
      if (!window.confirm(`備份日期：${date}\n版本：v${prepared.preview.sourceVersion}\nSession：${prepared.preview.sessions}\nRoutine：${prepared.preview.routines}\n動作：${prepared.preview.exercises}\n\n匯入會取代目前所有資料；系統會先下載 emergency backup。確定繼續？`)) return
      await importPreparedBackup(prepared.data, repository)
      const resumed = await repository.getActiveSession()
      activeRef.current = resumed
      setActiveSession(resumed)
      setScreen(initialScreenForActiveSession(resumed))
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
          id: createId(), name: '', label: '自訂訓練', accent: '#d2f072', order: routines.length,
          exercises: [], updatedAt: new Date().toISOString(),
        })}
      />}
      {screen === 'routine' && selectedRoutine && <RoutineScreen
        routine={selectedRoutine} definitions={definitions} unit={settings.unit} sessions={completed}
        onBack={() => setScreen('home')} onStart={() => void startRoutine(selectedRoutine)}
        onEdit={() => setEditingRoutine(selectedRoutine)} onClone={() => void duplicateRoutine(selectedRoutine)} onDelete={() => void deleteRoutine(selectedRoutine)}
      />}
      {screen === 'workout' && activeSession && <WorkoutScreen
        session={activeSession} previousSessions={completed} unit={settings.unit}
        onBack={() => setScreen('home')} onFinish={() => void finishSession()}
        onDiscard={() => void discardSession()}
        onUpdateSet={updateSet} onToggleSet={toggleSet} onAddSet={addSet} onRemoveSet={removeSet}
        onMoveExercise={reorderSessionExercise}
        definitions={definitions} readOnly={sessionReadOnly} onUpdateIdentity={updateExerciseIdentity}
        onAddExercise={() => setShowAddExercise(true)}
        onDismissTimer={() => updateSession((current) => ({ ...current, restEndsAt: null }))}
        onShiftTimer={(seconds) => updateSession((current) => ({ ...current, restEndsAt: shiftRestEnd(current.restEndsAt, seconds, Date.now()) }))}
        onExpireTimer={() => updateSession((current) => current.restEndsAt && current.restEndsAt <= Date.now() ? { ...current, restEndsAt: null } : current)}
      />}
      {screen === 'summary' && summarySession && <WorkoutSummary session={summarySession} previousSessions={completed} unit={settings.unit} onHome={() => setScreen('home')} onHistory={() => { setScreen('history'); setHistoryDetailId(summarySession.id) }} />}
      {screen === 'history' && <HistoryScreen sessions={completed} onOpen={setHistoryDetailId} />}
      {screen === 'progress' && <ProgressScreen sessions={completed} definitions={definitions} unit={settings.unit} onOpenLibrary={() => setScreen('library')} />}
      {screen === 'settings' && <SettingsScreen
        settings={settings} persisted={persisted} onChange={(patch) => void changeSettings(patch)}
        onExport={() => void exportBackup(repository)} onExportCsv={() => void exportCsv(repository)}
        onImport={() => importInput.current?.click()}
        onOpenLibrary={() => setScreen('library')}
        onRequestPersistence={async () => {
          if (!navigator.storage?.persist) { setToast('此瀏覽器不支援持久儲存設定'); return }
          const result = await navigator.storage.persist()
          setPersisted(result)
          setToast(result ? '已加強本機資料保存' : '瀏覽器未啟用持久儲存，請定期匯出備份')
        }}
      />}
      {screen === 'library' && <ExerciseLibrary definitions={definitions} routines={routines} sessions={sessions}
        onBack={() => setScreen('settings')} onSave={saveDefinition} onArchive={archiveDefinition} onMerge={mergeDefinitions} />}
      {!['routine', 'workout', 'summary'].includes(screen) && <BottomNav screen={screen} onChange={setScreen} />}
      {editingRoutine && <RoutineEditor
        routine={editingRoutine} definitions={definitions} unit={settings.unit} onClose={() => setEditingRoutine(null)}
        onCreateDefinition={saveDefinition}
        onSave={(routine) => void saveRoutine(routine)}
      />}
      {showAddExercise && <AddExerciseModal
        unit={settings.unit} definitions={definitions} onClose={() => setShowAddExercise(false)} onAdd={addWorkoutExercise}
        onCreateDefinition={saveDefinition}
      />}
      {historyDetail && <HistoryDetail
        key={historyDetail.id} session={historyDetail} unit={settings.unit} onClose={() => setHistoryDetailId(null)}
        onSave={async (edited) => { await saveHistoryEdit(historyDetail, edited); setHistoryDetailId(null) }}
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

function RoutineScreen({ routine, definitions, unit, sessions, onBack, onStart, onEdit, onClone, onDelete }: {
  routine: Routine
  definitions: ExerciseDefinition[]
  unit: AppSettings['unit']
  sessions: WorkoutSession[]
  onBack: () => void
  onStart: () => void
  onEdit: () => void
  onClone: () => void
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
        {routine.exercises.map((exercise, index) => { const definition = definitions.find((item) => item.id === exercise.exerciseDefinitionId); return <div className="exercise-list-item" key={exercise.id}>
          <span className="exercise-list-number">{String(index + 1).padStart(2, '0')}</span>
          <div className="exercise-list-main"><strong>{definition?.name ?? '找不到動作'}</strong><small>{definition ? variantSubtitle({ equipment: exercise.defaultEquipment, variation: exercise.defaultVariation }) : '動作定義遺失'}{exercise.note && ` · ${exercise.note}`}{definition?.archived && ' · 已封存'}</small></div>
          <div className="exercise-list-target"><strong>{exercise.weight === null ? '—' : `${displayWeight(exercise.weight, unit)} ${unit}`}</strong><small>{formatTargetRange(exercise.targetRepsMin, exercise.targetRepsMax) || `${exercise.reps ?? '—'} 下`} × {exercise.sets} 組</small></div>
        </div> })}
        {routine.exercises.length === 0 && <div className="empty-inline">這份菜單還沒有動作。點右上角編輯開始加入。</div>}
      </div>
      <div className="routine-secondary-actions"><button className="routine-clone" onClick={onClone}><Plus size={16} /> 複製菜單</button><button className="quiet-delete" onClick={onDelete}><Trash2 size={15} /> 刪除這份菜單</button></div>
    </div>
    <div className="sticky-action"><div className="sticky-action-inner"><button className="primary-button" onClick={onStart} disabled={routine.exercises.length === 0}><Play size={18} fill="currentColor" /> 開始訓練 <ArrowRight size={19} /></button></div></div>
  </main>
}

function WorkoutScreen({ session, previousSessions, definitions, unit, readOnly, onBack, onFinish, onDiscard, onUpdateSet, onToggleSet, onAddSet, onRemoveSet, onMoveExercise, onAddExercise, onUpdateIdentity, onDismissTimer, onShiftTimer, onExpireTimer }: {
  session: WorkoutSession
  previousSessions: WorkoutSession[]
  definitions: ExerciseDefinition[]
  unit: AppSettings['unit']
  readOnly: boolean
  onBack: () => void
  onFinish: () => void
  onDiscard: () => void
  onUpdateSet: (exerciseId: string, setId: string, patch: Partial<SetLog>) => void
  onToggleSet: (exercise: SessionExercise, set: SetLog) => void
  onAddSet: (exerciseId: string) => void
  onRemoveSet: (exerciseId: string, setId: string) => void
  onMoveExercise: (exerciseId: string, direction: -1 | 1) => void
  onAddExercise: () => void
  onUpdateIdentity: (exerciseId: string, equipment: string, variation: string) => void
  onDismissTimer: () => void
  onShiftTimer: (seconds: number) => void
  onExpireTimer: () => void
}) {
  const completed = completedSetCount(session)
  const planned = plannedSetCount(session)
  const [openRirSetId, setOpenRirSetId] = useState<string | null>(null)
  return <main className="page workout-page">
    <div className="content-wrap">
      <header className="detail-topbar"><button className="icon-button" onClick={onBack} aria-label="返回首頁"><ArrowLeft size={22} /></button>
        <span className="topbar-title"><span className="live-dot" /> 訓練進行中</span>
        <button className="topbar-link" onClick={onFinish} disabled={readOnly}>完成</button></header>
      {readOnly && <div className="readonly-warning" role="alert">另一個分頁正在編輯這筆訓練。本頁目前為唯讀，關閉另一個分頁後再重新開啟即可編輯。</div>}
      <div className="workout-heading"><div><span className="eyebrow">TODAY'S SESSION</span><h1>{session.routineName}</h1><p>{formatDate(session.startedAt)} <span className="middle-dot">·</span> 已訓練 <WorkoutElapsed startedAt={session.startedAt} /></p></div>
        <div className="workout-ring"><span>{completed}<small>/{planned}</small></span><svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="34" /><circle className="ring-fill" cx="40" cy="40" r="34" style={{ strokeDasharray: `${planned ? completed / planned * 214 : 0} 214` }} /></svg></div></div>
      <div className="workout-progress-track"><span style={{ width: `${planned ? completed / planned * 100 : 0}%` }} /></div>
      <p className="workout-progress-caption">已完成 {completed} / {planned} 組 <span>每完成一組，紀錄會自動儲存</span></p>

      {session.restEndsAt !== null && <RestTimer restEndsAt={session.restEndsAt} onShift={onShiftTimer} onSkip={onDismissTimer} onExpire={onExpireTimer} />}

      <div className="workout-exercises">
        {session.exercises.map((exercise, exerciseIndex) => {
          const done = exercise.sets.filter((set) => set.done).length
          const previous = findPreviousPerformance(exercise, previousSessions, session.id)
          const suggestion = previous ? getProgressionSuggestion(exercise.targetRepsMin, exercise.targetRepsMax, previous.sets) : null
          const definition = definitions.find((item) => item.id === exercise.exerciseDefinitionId)
          const identityLocked = !canChangeExerciseIdentity(exercise)
          return <section className="workout-exercise-card" key={exercise.id}>
            <div className="workout-exercise-head"><span className="workout-exercise-index">{String(exerciseIndex + 1).padStart(2, '0')}</span><div><h2>{exercise.name}</h2><p>{variantSubtitle(exercise)}</p>{formatTargetRange(exercise.targetRepsMin, exercise.targetRepsMax) && <small className="workout-target">目標 {formatTargetRange(exercise.targetRepsMin, exercise.targetRepsMax)}</small>}{exercise.note.trim() && <small className="workout-note">{exercise.note}</small>}</div><span className="set-count">{done}/{exercise.sets.length}</span></div>
            <div className="workout-variant-grid">
              <VariantInput label="器材" value={exercise.equipment} options={definition?.equipmentOptions ?? []} placeholder="選擇器材" disabled={readOnly || identityLocked} onChange={(equipment) => onUpdateIdentity(exercise.id, equipment, exercise.variation)} />
              <VariantInput label="變化" value={exercise.variation} options={definition?.variationOptions ?? []} placeholder="選擇變化" disabled={readOnly || identityLocked} onChange={(variation) => onUpdateIdentity(exercise.id, exercise.equipment, variation)} />
            </div>
            {identityLocked && <p className="identity-lock-note">已有完成的正式組，如需更換器材請新增另一個動作。</p>}
            <div className="session-order-controls"><span>當次順序</span><button disabled={readOnly || exerciseIndex === 0} onClick={() => onMoveExercise(exercise.id, -1)} aria-label={`上移 ${exercise.name}`}>↑ 上移</button><button disabled={readOnly || exerciseIndex === session.exercises.length - 1} onClick={() => onMoveExercise(exercise.id, 1)} aria-label={`下移 ${exercise.name}`}>↓ 下移</button></div>
            {previous && <div className="previous-performance"><div className="previous-performance-heading"><RotateCcw size={14} /><strong>上次正式組</strong><span>{formatDate(previous.date, { year: 'numeric', month: 'numeric', day: 'numeric' })}</span></div><div className="previous-performance-sets">{previous.sets.map((set, index) => <span key={set.id}><small>{index + 1}</small>{set.weight === null ? '—' : `${displayWeight(set.weight, unit)} ${unit}`} × {set.reps ?? '—'} 下{set.rir !== null && <em> · {formatRir(set.rir)}</em>}</span>)}</div>{suggestion && suggestion.kind !== 'none' && <p className="progression-suggestion"><strong>下次建議</strong>{suggestion.text}</p>}</div>}
            <div className="set-table-header"><span>組別</span><span>重量 <small>{unit}</small></span><span>次數</span><span>完成</span><span /></div>
            <div className="set-table-body">{exercise.sets.map((set, index) => <div className="set-entry" key={set.id}><div className={`set-row ${set.done ? 'is-done' : ''}`}>
              <button disabled={readOnly} className={`set-kind ${set.kind === 'warmup' ? 'is-warmup' : ''}`} title="點擊切換暖身／正式組" onClick={() => { onUpdateSet(exercise.id, set.id, { kind: set.kind === 'warmup' ? 'working' : 'warmup', rir: null }); setOpenRirSetId(null) }}><b>{index + 1}</b><small>{set.kind === 'warmup' ? '暖身' : '正式'}</small></button>
              <NumberInput disabled={readOnly} ariaLabel={`${exercise.name} 第 ${index + 1} 組重量`} quickLabel={`重量 ${unit}`} value={displayWeight(set.weight, unit)} placeholder="—" onChange={(value) => onUpdateSet(exercise.id, set.id, { weight: weightToKg(value, unit) })} onStep={(direction) => {
                const kg = adjustWeightKg(set.weight, unit, direction)
                onUpdateSet(exercise.id, set.id, { weight: kg })
                return displayWeight(kg, unit)
              }} />
              <NumberInput disabled={readOnly} ariaLabel={`${exercise.name} 第 ${index + 1} 組次數`} quickLabel="次數" value={set.reps === null ? '' : String(set.reps)} placeholder="—" integer onChange={(value) => onUpdateSet(exercise.id, set.id, { reps: value })} onStep={(direction) => {
                const reps = adjustReps(set.reps, direction)
                onUpdateSet(exercise.id, set.id, { reps })
                return String(reps)
              }} />
              <button disabled={readOnly} className={`set-check ${set.done ? 'checked' : ''}`} onClick={() => { onToggleSet(exercise, set); setOpenRirSetId(!set.done && set.kind === 'working' ? set.id : null) }} aria-label={set.done ? '取消完成' : '完成這組'}><Check size={20} strokeWidth={3} /></button>
              <button disabled={readOnly} className="remove-set" onClick={() => onRemoveSet(exercise.id, set.id)} aria-label="刪除這組"><Trash2 size={14} /></button>
            </div>{set.done && set.kind === 'working' && <div className="rir-control"><button className="rir-toggle" onClick={() => setOpenRirSetId(openRirSetId === set.id ? null : set.id)} aria-expanded={openRirSetId === set.id}>{set.rir === null ? '填寫 RIR（可略過）' : formatRir(set.rir)}</button>{openRirSetId === set.id && <div className="rir-options" aria-label={`第 ${index + 1} 組 RIR`}><button onClick={() => { onUpdateSet(exercise.id, set.id, { rir: null }); setOpenRirSetId(null) }}>清除</button>{([0, 1, 2, 3, 4] as const).map((rir) => <button key={rir} className={set.rir === rir ? 'selected' : ''} onClick={() => { onUpdateSet(exercise.id, set.id, { rir }); setOpenRirSetId(null) }}>{rir === 4 ? '4+' : rir}</button>)}</div>}</div>}</div>)}</div>
            <button className="add-set-button" disabled={readOnly} onClick={() => onAddSet(exercise.id)}><Plus size={16} /> 加一組</button>
          </section>
        })}
      </div>
      <button className="add-exercise-button" onClick={onAddExercise} disabled={readOnly}><Plus size={19} /> 加入動作</button>
      <button className="quiet-delete workout-discard" onClick={onDiscard} disabled={readOnly}><Trash2 size={15} /> 捨棄這次訓練</button>
    </div>
    <div className="sticky-action"><div className="sticky-action-inner"><button className="primary-button" onClick={onFinish} disabled={readOnly}><CheckCircle2 size={20} /> 結束並儲存訓練 <ArrowRight size={19} /></button></div></div>
  </main>
}

function WorkoutElapsed({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const refresh = () => setNow(Date.now())
    const interval = window.setInterval(refresh, 15000)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])
  return <>{formatDuration(durationMinutes(startedAt, now))}</>
}

function RestTimer({ restEndsAt, onShift, onSkip, onExpire }: {
  restEndsAt: number
  onShift: (seconds: number) => void
  onSkip: () => void
  onExpire: () => void
}) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const refresh = () => setNow(Date.now())
    refresh()
    const interval = window.setInterval(refresh, 1000)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [restEndsAt])
  const remaining = remainingRestSeconds(restEndsAt, now)
  useEffect(() => {
    if (remaining === 0) onExpire()
  }, [remaining, onExpire])
  if (remaining === 0) return null
  return <div className="rest-banner" role="timer" aria-label="休息倒數">
    <span className="rest-icon"><Timer size={21} /></span>
    <span className="rest-copy"><strong>休息計時</strong><small>準備好就繼續下一組</small></span>
    <b>{String(Math.floor(remaining / 60)).padStart(2, '0')}:{String(remaining % 60).padStart(2, '0')}</b>
    <div className="rest-controls"><button onClick={() => onShift(-15)} aria-label="休息減少 15 秒">-15</button><button onClick={() => onShift(15)} aria-label="休息增加 15 秒">+15</button><button onClick={onSkip} aria-label="跳過休息">跳過</button></div>
  </div>
}

function WorkoutSummary({ session, previousSessions, unit, onHome, onHistory }: { session: WorkoutSession, previousSessions: WorkoutSession[], unit: AppSettings['unit'], onHome: () => void, onHistory: () => void }) {
  const volume = completedWorkingVolumeKg(session)
  const newPrs = newSessionPrs(session, previousSessions)
  return <main className="page summary-page"><div className="content-wrap">
    <BrandHeader eyebrow="訓練已完成" />
    <div className="summary-hero"><span className="summary-icon"><CheckCircle2 size={35} /></span><span className="eyebrow">WORKOUT COMPLETE</span><h1>{session.routineName}</h1><p>{formatDate(session.startedAt, { year: 'numeric', month: 'long', day: 'numeric' })}</p></div>
    <div className="summary-stats"><div><Clock3 size={20} /><span>訓練時間</span><strong>{formatDuration(durationMinutes(session.startedAt, session.endedAt ?? session.startedAt))}</strong></div><div><CheckCircle2 size={20} /><span>完成組數</span><strong>{completedSetCount(session)} / {plannedSetCount(session)}</strong></div><div><Dumbbell size={20} /><span>訓練量</span><strong>{new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 }).format(volume)} <small>kg</small></strong></div></div>
    {newPrs.length > 0 && <section className="summary-prs"><h2>本次新紀錄</h2>{newPrs.map((pr) => <div key={`${pr.exerciseDefinitionId}-${pr.equipment}-${pr.variation}-${pr.kind}-${pr.set.weight}`}><span><strong>{pr.name}</strong><small>{variantSubtitle(pr)}</small></span><b>{displayWeight(pr.set.weight, unit)} {unit} × {pr.set.reps}</b><em>{pr.kind === 'weight' ? '重量 PR' : '同重量次數 PR'}</em></div>)}</section>}
    <button className="primary-button summary-primary" onClick={onHome}>完成，回首頁 <ArrowRight size={19} /></button>
    <button className="summary-secondary" onClick={onHistory}>查看這次訓練紀錄</button>
  </div></main>
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

function ProgressScreen({ sessions, definitions, unit, onOpenLibrary }: { sessions: WorkoutSession[], definitions: ExerciseDefinition[], unit: AppSettings['unit'], onOpenLibrary: () => void }) {
  const [tab, setTab] = useState<'exercises' | 'muscles'>('exercises')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [selectedPrWeightKg, setSelectedPrWeightKg] = useState<number | null>(null)
  const records = useMemo(() => {
    const byId = new Map(definitions.map((definition) => [definition.id, definition]))
    const map = new Map<string, { key: string, definition: ExerciseDefinition, identity: SessionExercise, points: { date: string, max: number }[] }>()
    for (const session of [...sessions].reverse()) {
      const maxById = new Map<string, { exercise: SessionExercise, max: number }>()
      for (const exercise of session.exercises) {
        const done = exercise.sets.filter((set) => set.done && set.kind === 'working' && set.weight !== null)
        if (done.length === 0) continue
        const key = exerciseIdentityKey(exercise)
        const max = Math.max(...done.map((set) => set.weight ?? 0))
        const current = maxById.get(key)
        maxById.set(key, { exercise, max: Math.max(current?.max ?? 0, max) })
      }
      for (const [key, value] of maxById) {
        const definition = byId.get(value.exercise.exerciseDefinitionId)
        if (!definition) continue
        const current = map.get(key) ?? { key, definition, identity: value.exercise, points: [] }
        current.points.push({ date: session.startedAt, max: value.max })
        map.set(key, current)
      }
    }
    return [...map.values()].sort((a, b) => b.points.length - a.points.length || a.definition.name.localeCompare(b.definition.name, 'zh-TW'))
  }, [sessions, definitions])
  const chosen = records.find((record) => record.key === selectedKey) ?? records[0]
  const exerciseHistory = useMemo(() => chosen ? findExerciseHistory(chosen.identity, sessions) : [], [chosen, sessions])
  const historyPoints = useMemo(() => [...exerciseHistory].reverse().flatMap((entry) => {
    const weights = entry.sets.filter((set) => set.kind === 'working' && set.weight !== null).map((set) => set.weight!)
    return weights.length ? [{ date: entry.date, max: Math.max(...weights) }] : []
  }), [exerciseHistory])
  const current = historyPoints.at(-1)
  const best = historyPoints.length ? Math.max(...historyPoints.map((point) => point.max)) : 0
  const converter = unit === 'lb' ? 2.2046226218 : 1
  const prs = useMemo(() => calculateExercisePr(exerciseHistory), [exerciseHistory])
  const volumePoints = useMemo(() => chosen ? exerciseVolumeSeries(chosen.identity, sessions) : [], [chosen, sessions])
  const repsPr = prs.repsPrByWeight.find((entry) => entry.weightKg === selectedPrWeightKg) ?? prs.repsPrByWeight[0]
  return <main className="page page-with-nav"><div className="content-wrap">
    <BrandHeader eyebrow="數據趨勢" />
    <div className="page-title"><span className="eyebrow">GET STRONGER</span><h1>進步軌跡<span className="title-dot">.</span></h1><p>讓重量替你說話。</p></div>
    <div className="progress-tabs"><button className={tab === 'exercises' ? 'selected' : ''} onClick={() => setTab('exercises')}>動作</button><button className={tab === 'muscles' ? 'selected' : ''} onClick={() => setTab('muscles')}>肌群</button></div>
    {tab === 'muscles' ? <MuscleProgress sessions={sessions} definitions={definitions} onOpenLibrary={onOpenLibrary} /> : <>
    {records.length === 0 ? <EmptyState icon={<LineChart size={34} />} title="進步正在累積" description="完成訓練並勾選組別後，這裡會顯示每個動作的重量變化。" /> : <>
      <div className="section-heading compact"><div><span className="eyebrow">EXERCISE</span><h2>選擇動作</h2></div></div>
      <div className="exercise-picker">{records.map((record) => <button key={record.key} className={chosen?.key === record.key ? 'selected' : ''} onClick={() => { setSelectedKey(record.key); setSelectedPrWeightKg(null) }}>{record.definition.name}<small>{variantSubtitle(record.identity)}</small></button>)}</div>
      {chosen && <>
        <div className="progress-main-card"><div className="progress-main-header"><span><span className="eyebrow">MAX WEIGHT</span><h2>{chosen.definition.name}</h2><small>{variantSubtitle(chosen.identity)} · {historyPoints.length} 次訓練</small></span><span className="progress-icon"><Dumbbell size={24} /></span></div>
          <div className="progress-big-number">{Math.round(best * converter * 10) / 10}<span>{unit}</span></div><span className="progress-big-label">最高完成重量</span>
          <ProgressChart values={historyPoints.map((point) => point.max * converter)} />
          <div className="chart-labels"><span>{historyPoints[0] && formatDate(historyPoints[0].date, { month: 'numeric', day: 'numeric' })}</span><span>{current && formatDate(current.date, { month: 'numeric', day: 'numeric' })}</span></div>
        </div>
        <div className="progress-stat-grid"><div className="progress-stat"><span>最近一次最高重量</span><strong>{Math.round((current?.max ?? 0) * converter * 10) / 10}<small> {unit}</small></strong></div></div>
        {volumePoints.length > 0 && <section className="volume-trend"><span className="eyebrow">RECORDED VOLUME</span><h2>紀錄訓練量趨勢</h2><strong>{displayWeight(volumePoints.at(-1)!.volumeKg, unit)} <small>{unit} × 次數</small></strong><ProgressChart values={volumePoints.map((point) => point.volumeKg * converter)} label="歷次紀錄訓練量趨勢" /><p>依每次已完成正式組的輸入重量 × 次數計算</p></section>}
        <div className="section-heading compact"><div><span className="eyebrow">PERSONAL RECORDS</span><h2>個人最佳</h2></div></div>
        <div className="pr-grid">
          <div className="pr-card"><span>重量 PR</span><strong>{prs.weightPr ? `${displayWeight(prs.weightPr.weight, unit)} ${unit} × ${prs.weightPr.reps}` : '—'}</strong></div>
          <div className="pr-card"><span>同重量次數 PR</span>{repsPr && <select aria-label="選擇 PR 重量" value={repsPr.weightKg} onChange={(event) => setSelectedPrWeightKg(Number(event.target.value))}>{prs.repsPrByWeight.map((entry) => <option key={entry.weightKg} value={entry.weightKg}>{displayWeight(entry.weightKg, unit)} {unit}</option>)}</select>}<strong>{repsPr ? `${displayWeight(repsPr.weightKg, unit)} ${unit} × ${repsPr.reps}` : '—'}</strong></div>
          <div className="pr-card"><span>估算 1RM PR</span><strong>{prs.estimatedOneRepMaxPr ? `${displayWeight(prs.estimatedOneRepMaxPr.estimateKg, unit)} ${unit}` : '—'}</strong><small>Epley：重量 × (1 + 次數 / 30)</small></div>
        </div>
        <div className="section-heading compact"><div><span className="eyebrow">FULL HISTORY</span><h2>動作歷史</h2></div><span className="count-chip">{exerciseHistory.length} 次</span></div>
        <div className="exercise-history">{exerciseHistory.map((entry) => <section className="exercise-history-card" key={entry.sessionId}>
          <div className="exercise-history-head"><strong>{formatDate(entry.date, { year: 'numeric', month: 'numeric', day: 'numeric' })}</strong><span>{entry.routineName}</span></div>
          <div className="exercise-history-sets">{entry.sets.map((set, index) => <div className={set.kind === 'warmup' ? 'warmup' : ''} key={set.id}><small>{set.kind === 'warmup' ? '暖身' : `正式 ${index + 1}`}</small><strong>{set.weight === null ? '—' : `${displayWeight(set.weight, unit)} ${unit}`} × {set.reps ?? '—'}{set.rir !== null && <em> · {formatRir(set.rir)}</em>}</strong></div>)}</div>
        </section>)}</div>
      </>}
    </>}
    </>}
  </div></main>
}

function MuscleProgress({ sessions, definitions, onOpenLibrary }: { sessions: WorkoutSession[], definitions: ExerciseDefinition[], onOpenLibrary: () => void }) {
  const [weekOffset, setWeekOffset] = useState(0)
  const week = shiftLocalWeek(startOfLocalWeek(new Date()), weekOffset)
  const stats = weeklyMuscleStats(sessions, definitions, week)
  const nextWeekStart = shiftLocalWeek(week, 1)
  const canGoNext = weekOffset < 0 || sessions.some((session) => session.status === 'completed' && new Date(session.startedAt).getTime() >= nextWeekStart.getTime())
  const visible = stats.muscles.filter((row) => row.sets > 0)
  const maximum = Math.max(1, ...visible.map((row) => row.sets))
  return <section className="muscle-progress">
    <div className="muscle-week-header"><div><span className="eyebrow">PRIMARY MUSCLE SETS</span><h2>主要肌群有效組數</h2><p>{weekOffset === 0 ? '本週 · ' : ''}{formatDate(week.toISOString(), { year: 'numeric', month: 'numeric', day: 'numeric' })} ～ {formatDate(nextWeekStart.toISOString(), { month: 'numeric', day: 'numeric' })}（週一前）</p></div><div className="calendar-controls"><button onClick={() => setWeekOffset((offset) => offset - 1)} aria-label="上一週"><ChevronLeft size={19} /></button><button onClick={() => setWeekOffset((offset) => offset + 1)} disabled={!canGoNext} aria-label="下一週"><ChevronRight size={19} /></button></div></div>
    <p className="muscle-explainer">只計已完成訓練的正式完成組。若一個動作有多個主要肌群，每個肌群各計一組。</p>
    {visible.length ? <div className="muscle-rows">{visible.map((row) => <div className="muscle-row" key={row.muscle}><div><strong>{MUSCLE_LABELS[row.muscle]}</strong><span>{row.sets} 組 · {row.days} 天</span></div><div className="muscle-bar"><span style={{ width: `${row.sets / maximum * 100}%` }} /></div></div>)}</div> : <p className="library-empty">這週尚無已分類的正式組。</p>}
    <div className="unclassified-card"><strong>未分類 {stats.unclassifiedSets} 組</strong><small>可到動作庫補上主要肌群，過去統計會一起更新。</small>{stats.unclassifiedExercises.length > 0 && <ul>{stats.unclassifiedExercises.map((item) => { const definition = definitions.find((row) => row.id === item.exerciseDefinitionId); return <li key={item.exerciseDefinitionId}><span>{definition?.name ?? '找不到動作'}{definition?.archived && '（已封存）'}</span><b>{item.sets} 組</b></li> })}</ul>}{stats.unclassifiedSets > 0 && <button onClick={onOpenLibrary}>前往動作庫分類 <ArrowRight size={14} /></button>}</div>
  </section>
}

function ProgressChart({ values, label = '歷次最高重量趨勢' }: { values: number[], label?: string }) {
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const points = values.map((value, index) => {
    const x = values.length === 1 ? 150 : 15 + index / (values.length - 1) * 270
    const y = maximum === minimum ? 65 : 108 - (value - minimum) / (maximum - minimum) * 85
    return { x, y }
  })
  const line = points.map((point) => `${point.x},${point.y}`).join(' ')
  const area = `15,120 ${line} 285,120`
  return <svg className="progress-chart" viewBox="0 0 300 128" preserveAspectRatio="none" role="img" aria-label={label}>
    <defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#d2f072" stopOpacity=".22" /><stop offset="1" stopColor="#d2f072" stopOpacity="0" /></linearGradient></defs>
    <path d="M0 108H300 M0 65H300 M0 23H300" className="chart-grid" />
    {points.length > 1 && <polygon points={area} fill="url(#chartFill)" />}
    {points.length > 1 && <polyline points={line} fill="none" stroke="#d2f072" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
    {points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="4.7" fill="#d2f072" stroke="#162015" strokeWidth="3" />)}
  </svg>
}

function SettingsScreen({ settings, persisted, onChange, onExport, onExportCsv, onImport, onOpenLibrary, onRequestPersistence }: {
  settings: AppSettings
  persisted: boolean | null
  onChange: (patch: Partial<AppSettings>) => void
  onExport: () => void
  onExportCsv: () => void
  onImport: () => void
  onOpenLibrary: () => void
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
    <section className="settings-section"><div className="section-heading compact"><div><span className="eyebrow">EXERCISES</span><h2>動作管理</h2></div></div><div className="setting-card"><button className="setting-row setting-button" onClick={onOpenLibrary}><span className="setting-icon"><Dumbbell size={19} /></span><span className="setting-copy"><strong>動作庫</strong><small>建立、分類、封存與合併全域動作</small></span><ChevronRight size={18} /></button></div></section>
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

function HistoryDetail({ session, unit, onClose, onDelete, onSave }: {
  session: WorkoutSession
  unit: AppSettings['unit']
  onClose: () => void
  onDelete: () => void
  onSave: (edited: WorkoutSession) => Promise<void>
}) {
  const duration = formatDuration(durationMinutes(session.startedAt, session.endedAt ?? session.startedAt))
  const [draft, setDraft] = useState<WorkoutSession>(() => structuredClone(session))
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  function patchSet(exerciseId: string, setId: string, patch: Partial<SetLog>) {
    setDraft((current) => ({ ...current, exercises: current.exercises.map((exercise) => exercise.id !== exerciseId ? exercise : {
      ...exercise, sets: exercise.sets.map((set) => set.id === setId ? { ...set, ...patch } : set),
    }) }))
  }
  function patchHistoryExercise(exerciseId: string, patch: Pick<SessionExercise, 'equipment' | 'variation'>) {
    setDraft((current) => ({ ...current, exercises: current.exercises.map((exercise) =>
      exercise.id === exerciseId ? { ...exercise, ...patch } : exercise) }))
  }
  function addHistorySet(exerciseId: string) {
    setDraft((current) => ({ ...current, exercises: current.exercises.map((exercise) => {
      if (exercise.id !== exerciseId) return exercise
      const last = exercise.sets.at(-1)
      return { ...exercise, sets: [...exercise.sets, { id: createId(), weight: last?.weight ?? null,
        reps: last?.reps ?? null, rir: null, done: false, kind: 'working' as const }] }
    }) }))
  }
  function removeHistorySet(exerciseId: string, setId: string) {
    setDraft((current) => ({ ...current, exercises: current.exercises.map((exercise) =>
      exercise.id === exerciseId ? { ...exercise, sets: exercise.sets.filter((set) => set.id !== setId) } : exercise) }))
  }
  async function save() {
    try {
      validateCompletedSessionEdit(session, draft)
      setSaving(true)
      await onSave(draft)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '無法儲存訓練紀錄') }
    finally { setSaving(false) }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="sheet detail-sheet" role="dialog" aria-modal="true" aria-label="訓練詳情">
      <div className="sheet-header"><div><span className="eyebrow">WORKOUT DETAIL</span><h2>{session.routineName}</h2></div><button className="icon-button" onClick={onClose} aria-label="關閉"><X size={21} /></button></div>
      <div className="sheet-scroll" ref={scrollRef}>
        <p className="sheet-date">{formatDate(session.startedAt, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</p>
        <div className="detail-stats"><div><Clock3 size={17} /><strong>{duration}</strong><span>訓練時間</span></div><div><CheckCircle2 size={17} /><strong>{completedSetCount(editing ? draft : session)}</strong><span>完成組數</span></div><div><Dumbbell size={17} /><strong>{session.exercises.length}</strong><span>訓練動作</span></div></div>
        {!editing && <button className="routine-clone" onClick={() => { scrollRef.current?.scrollTo(0, 0); setEditing(true) }}><Pencil size={15} /> 編輯紀錄</button>}
        <div className="detail-exercise-list">{(editing ? draft : session).exercises.map((exercise, index) => <section key={exercise.id} className="detail-exercise"><div className="detail-exercise-title"><span>{String(index + 1).padStart(2, '0')}</span><div><h3>{exercise.name}</h3><small>{variantSubtitle(exercise)}{exercise.note.trim() && ` · ${exercise.note}`}</small></div></div>
          {editing ? <div className="history-edit-sets"><div className="history-identity-edit"><label><span>器材</span><input value={exercise.equipment} onChange={(event) => patchHistoryExercise(exercise.id, { equipment: event.target.value, variation: exercise.variation })} onBlur={(event) => patchHistoryExercise(exercise.id, { equipment: normalizeExerciseText(event.target.value), variation: exercise.variation })} /></label><label><span>變化</span><input value={exercise.variation} onChange={(event) => patchHistoryExercise(exercise.id, { equipment: exercise.equipment, variation: event.target.value })} onBlur={(event) => patchHistoryExercise(exercise.id, { equipment: exercise.equipment, variation: normalizeExerciseText(event.target.value) })} /></label></div>{exercise.sets.map((set, setIndex) => <div className="history-edit-set" key={set.id}>
            <strong>第 {setIndex + 1} 組</strong><button className="history-remove-set" onClick={() => removeHistorySet(exercise.id, set.id)} aria-label={`刪除第 ${setIndex + 1} 組`}><Trash2 size={14} /> 刪除</button><label><span>重量 {unit}</span><NumberInput value={displayWeight(set.weight, unit)} onChange={(value) => patchSet(exercise.id, set.id, { weight: weightToKg(value, unit) })} placeholder="—" ariaLabel={`${exercise.name} 第 ${setIndex + 1} 組重量`} /></label>
            <label><span>次數</span><NumberInput value={set.reps === null ? '' : String(set.reps)} onChange={(value) => patchSet(exercise.id, set.id, { reps: value })} placeholder="—" ariaLabel={`${exercise.name} 第 ${setIndex + 1} 組次數`} integer /></label>
            <label><span>RIR</span><select aria-label={`${exercise.name} 第 ${setIndex + 1} 組 RIR`} value={set.rir ?? ''} disabled={!set.done || set.kind === 'warmup'} onChange={(event) => patchSet(exercise.id, set.id, { rir: event.target.value === '' ? null : Number(event.target.value) as SetLog['rir'] })}><option value="">—</option>{[0, 1, 2, 3, 4].map((rir) => <option key={rir} value={rir}>{rir === 4 ? '4+' : rir}</option>)}</select></label>
            <label><span>類型</span><select aria-label={`${exercise.name} 第 ${setIndex + 1} 組類型`} value={set.kind} onChange={(event) => patchSet(exercise.id, set.id, { kind: event.target.value as SetLog['kind'], rir: event.target.value === 'warmup' ? null : set.rir })}><option value="working">正式</option><option value="warmup">暖身</option></select></label>
            <label className="history-edit-done"><input type="checkbox" checked={set.done} onChange={(event) => patchSet(exercise.id, set.id, { done: event.target.checked, rir: event.target.checked ? set.rir : null })} /> 已完成</label>
          </div>)}<button className="add-set-button" onClick={() => addHistorySet(exercise.id)}><Plus size={15} /> 新增一組</button></div> : <div className="detail-set-list">{exercise.sets.map((set, setIndex) => <div key={set.id} className={set.done ? '' : 'muted'}><span>{set.kind === 'warmup' ? '暖身' : `第 ${setIndex + 1} 組`}</span><strong>{set.weight === null ? '—' : displayWeight(set.weight, unit)} {unit} <small>×</small> {set.reps ?? '—'} 下{set.rir !== null && ` · ${formatRir(set.rir)}`}</strong>{set.done ? <Check size={16} /> : <Minus size={16} />}</div>)}</div>}
        </section>)}</div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {!editing && <button className="quiet-delete" onClick={onDelete}><Trash2 size={15} /> 刪除這筆紀錄</button>}
      </div>
      {editing && <div className="sheet-footer history-edit-actions"><button onClick={() => { setEditing(false); setDraft(structuredClone(session)); setError(''); scrollRef.current?.scrollTo(0, 0) }}>取消</button><button className="primary-button" disabled={saving} onClick={() => void save()}><Check size={17} /> 儲存修改</button></div>}
    </div>
  </div>
}

function RoutineEditor({ routine, definitions, unit, onClose, onSave, onCreateDefinition }: {
  routine: Routine
  definitions: ExerciseDefinition[]
  unit: AppSettings['unit']
  onClose: () => void
  onSave: (routine: Routine) => void
  onCreateDefinition: (definition: ExerciseDefinition) => Promise<void>
}) {
  const [draft, setDraft] = useState<Routine>(() => structuredClone(routine))
  const [selecting, setSelecting] = useState(false)
  const [creating, setCreating] = useState<ExerciseDefinition | null>(null)
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
  function addExercise(definition: ExerciseDefinition) {
    setDraft((current) => ({ ...current, exercises: [...current.exercises, {
      id: createId(), exerciseDefinitionId: definition.id, defaultEquipment: null, defaultVariation: null, weight: null, reps: 10,
      targetRepsMin: 8, targetRepsMax: 12, sets: 3, restSeconds: 90, note: '',
    }] }))
    setSelecting(false)
  }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="sheet editor-sheet" role="dialog" aria-modal="true" aria-label="編輯訓練菜單">
      <div className="sheet-header"><div><span className="eyebrow">ROUTINE EDITOR</span><h2>{routine.name ? '編輯菜單' : '新增菜單'}</h2></div><button className="icon-button" onClick={onClose} aria-label="關閉"><X size={21} /></button></div>
      <div className="sheet-scroll editor-scroll">
        <div className="form-grid"><label className="form-field"><span>菜單名稱</span><input value={draft.name} placeholder="例如 Push day" onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label className="form-field"><span>訓練部位／描述</span><input value={draft.label} placeholder="例如 胸・肩・三頭" onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label></div>
        <div className="editor-section-heading"><div><span className="eyebrow">EXERCISES</span><h3>動作安排</h3></div><span>{draft.exercises.length} 個動作</span></div>
        <div className="editor-exercises">{draft.exercises.map((exercise, index) => { const definition = definitions.find((item) => item.id === exercise.exerciseDefinitionId); return <div className="editor-exercise" key={exercise.id}>
          <div className="editor-exercise-top"><span className="editor-index">{String(index + 1).padStart(2, '0')}</span><div className="editor-exercise-name"><strong>{definition?.name ?? '找不到動作'}</strong><small>{variantSubtitle({ equipment: exercise.defaultEquipment, variation: exercise.defaultVariation })}{definition?.archived && ' · 已封存'}</small></div><button onClick={() => moveExercise(index, -1)} disabled={index === 0} aria-label="上移動作">↑</button><button onClick={() => moveExercise(index, 1)} disabled={index === draft.exercises.length - 1} aria-label="下移動作">↓</button><button onClick={() => setDraft({ ...draft, exercises: draft.exercises.filter((item) => item.id !== exercise.id) })} aria-label="刪除動作"><Trash2 size={16} /></button></div>
          <div className="editor-exercise-grid">
            <VariantInput label="預設器材" value={exercise.defaultEquipment ?? ''} options={definition?.equipmentOptions ?? []} placeholder="訓練時再選" onChange={(value) => patchExercise(exercise.id, { defaultEquipment: value || null })} />
            <VariantInput label="預設變化" value={exercise.defaultVariation ?? ''} options={definition?.variationOptions ?? []} placeholder="訓練時再選" onChange={(value) => patchExercise(exercise.id, { defaultVariation: value || null })} />
            <label className="form-field"><span>重量 {unit}</span><NumberInput value={displayWeight(exercise.weight, unit)} onChange={(value) => patchExercise(exercise.id, { weight: weightToKg(value, unit) })} placeholder="—" ariaLabel="預設重量" /></label>
            <label className="form-field"><span>預設次數</span><NumberInput value={exercise.reps === null ? '' : String(exercise.reps)} onChange={(value) => patchExercise(exercise.id, { reps: value })} placeholder="—" ariaLabel="預設次數" integer /></label>
            <div className="form-field wide"><span>目標次數</span><div className="target-range-input"><NumberInput value={exercise.targetRepsMin === null ? '' : String(exercise.targetRepsMin)} onChange={(value) => patchExercise(exercise.id, { targetRepsMin: value })} placeholder="下限" ariaLabel="目標次數下限" integer /><span>～</span><NumberInput value={exercise.targetRepsMax === null ? '' : String(exercise.targetRepsMax)} onChange={(value) => patchExercise(exercise.id, { targetRepsMax: value })} placeholder="上限" ariaLabel="目標次數上限" integer /></div></div>
            <label className="form-field"><span>組數</span><NumberInput value={String(exercise.sets)} onChange={(value) => patchExercise(exercise.id, { sets: Math.max(1, value ?? 1) })} placeholder="3" ariaLabel="預設組數" integer /></label>
            <label className="form-field"><span>休息 秒</span><NumberInput value={String(exercise.restSeconds)} onChange={(value) => patchExercise(exercise.id, { restSeconds: Math.max(0, value ?? 0) })} placeholder="90" ariaLabel="休息秒數" integer /></label>
            <label className="form-field full"><span>備註</span><input value={exercise.note} placeholder="例如 座椅高度、握法" onChange={(event) => patchExercise(exercise.id, { note: event.target.value })} /></label>
          </div>
        </div> })}</div>
        {selecting ? <ExercisePicker definitions={definitions} onSelect={addExercise} onCreate={() => setCreating(newDefinition())} /> : <button className="add-exercise-button" onClick={() => setSelecting(true)}><Plus size={18} /> 從動作庫新增</button>}
      </div>
      <div className="sheet-footer"><button className="primary-button" onClick={() => onSave(draft)}><Check size={19} /> 儲存菜單</button></div>
    </div>
    {creating && <ExerciseDefinitionEditor definition={creating} onClose={() => setCreating(null)} onSave={async (definition) => { await onCreateDefinition(definition); addExercise(definition); setCreating(null) }} />}
  </div>
}

function AddExerciseModal({ unit, definitions, onClose, onAdd, onCreateDefinition }: {
  unit: AppSettings['unit']
  definitions: ExerciseDefinition[]
  onClose: () => void
  onAdd: (definition: ExerciseDefinition, exercise: RoutineExercise) => void
  onCreateDefinition: (definition: ExerciseDefinition) => Promise<void>
}) {
  const [exercise, setExercise] = useState<RoutineExercise>({
    id: createId(), exerciseDefinitionId: '', defaultEquipment: null, defaultVariation: null, weight: null, reps: 10,
    targetRepsMin: 8, targetRepsMax: 12, sets: 3, restSeconds: 90, note: '',
  })
  const [creating, setCreating] = useState<ExerciseDefinition | null>(null)
  const selected = definitions.find((item) => item.id === exercise.exerciseDefinitionId)
  const patch = (value: Partial<RoutineExercise>) => setExercise((current) => ({ ...current, ...value }))
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="sheet small-sheet" role="dialog" aria-modal="true" aria-label="加入動作">
      <div className="sheet-header"><div><span className="eyebrow">ADD EXERCISE</span><h2>加入動作</h2></div><button className="icon-button" onClick={onClose} aria-label="關閉"><X size={21} /></button></div>
      <div className="sheet-scroll">{selected ? <><div className="selected-definition"><strong>{selected.name}</strong><small>{definitionSubtitle(selected)}</small><button onClick={() => patch({ exerciseDefinitionId: '', defaultEquipment: null, defaultVariation: null })}>更換</button></div>
        <div className="quick-exercise-grid"><VariantInput label="預設器材" value={exercise.defaultEquipment ?? ''} options={selected.equipmentOptions} placeholder="訓練時再選" onChange={(value) => patch({ defaultEquipment: value || null })} /><VariantInput label="預設變化" value={exercise.defaultVariation ?? ''} options={selected.variationOptions} placeholder="訓練時再選" onChange={(value) => patch({ defaultVariation: value || null })} /><label className="form-field"><span>重量 {unit}</span><NumberInput value={displayWeight(exercise.weight, unit)} onChange={(value) => patch({ weight: weightToKg(value, unit) })} placeholder="—" ariaLabel="重量" /></label><label className="form-field"><span>次數</span><NumberInput value={exercise.reps === null ? '' : String(exercise.reps)} onChange={(value) => patch({ reps: value })} placeholder="10" ariaLabel="次數" integer /></label><label className="form-field"><span>組數</span><NumberInput value={String(exercise.sets)} onChange={(value) => patch({ sets: Math.max(1, value ?? 1) })} placeholder="3" ariaLabel="組數" integer /></label></div></> : <ExercisePicker definitions={definitions} onSelect={(definition) => patch({ exerciseDefinitionId: definition.id })} onCreate={() => setCreating(newDefinition())} />}
      </div>
      <div className="sheet-footer"><button className="primary-button" disabled={!selected} onClick={() => selected && onAdd(selected, exercise)}><Plus size={19} /> 加入訓練</button></div>
    </div>
    {creating && <ExerciseDefinitionEditor definition={creating} onClose={() => setCreating(null)} onSave={async (definition) => { await onCreateDefinition(definition); patch({ exerciseDefinitionId: definition.id }); setCreating(null) }} />}
  </div>
}

function VariantInput({ label, value, options, placeholder, disabled, onChange }: {
  label: string
  value: string
  options: string[]
  placeholder: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const listId = useRef(`variant-${createId()}`)
  return <label className="variant-field"><span>{label}</span><input list={listId.current} value={value}
    disabled={disabled} placeholder={placeholder} onChange={(event) => onChange(event.target.value)}
    onBlur={(event) => onChange(normalizeExerciseText(event.target.value))} />
    <datalist id={listId.current}>{options.map((option) => <option key={option} value={option} />)}</datalist></label>
}

function NumberInput({ value, onChange, placeholder, ariaLabel, integer = false, quickLabel, onStep, disabled = false }: {
  value: string
  onChange: (value: number | null) => void
  placeholder: string
  ariaLabel: string
  integer?: boolean
  quickLabel?: string
  onStep?: (direction: -1 | 1) => string
  disabled?: boolean
}) {
  const [raw, setRaw] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setRaw(value)
  }, [value])
  const input = <input ref={inputRef} className="number-input" type="text" inputMode={integer ? 'numeric' : 'decimal'}
    aria-label={ariaLabel} value={raw} placeholder={placeholder} disabled={disabled}
    onChange={(event) => {
      const next = event.target.value.replace(',', '.')
      if (!(integer ? /^\d*$/.test(next) : /^\d*(?:\.\d*)?$/.test(next))) return
      setRaw(next)
      onChange(next === '' || next === '.' ? null : Number(next))
    }}
    onFocus={() => {
      if (onStep && window.matchMedia('(max-width: 560px)').matches) {
        window.setTimeout(() => {
          const input = inputRef.current
          if (input && document.activeElement === input) input.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }, 300)
      }
    }}
    onBlur={() => setRaw(value)} />
  if (!onStep) return input
  const step = (direction: -1 | 1) => setRaw(onStep(direction))
  const stepButton = (direction: -1 | 1) => <button type="button" disabled={disabled}
    aria-label={`${ariaLabel}${direction < 0 ? '減少' : '增加'}`}
    onPointerDown={(event) => { event.preventDefault(); step(direction) }}
    onClick={(event) => { if (event.detail === 0) step(direction) }}>
    {direction < 0 ? <Minus size={17} /> : <Plus size={17} />}
  </button>
  return <div className="number-stepper"><span className="number-stepper-label">{quickLabel}</span>{stepButton(-1)}{input}{stepButton(1)}</div>
}
