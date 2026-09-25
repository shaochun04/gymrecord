import { useMemo, useState } from 'react'
import { ArrowLeft, Check, ChevronRight, Plus, X } from 'lucide-react'
import type { ExerciseDefinition, MuscleGroup, Routine, WorkoutSession } from './types'
import { MUSCLE_GROUPS } from './types'
import { definitionLabel, definitionSubtitle, MUSCLE_LABELS, newDefinition, validateDefinition } from './exerciseDefinitions'

export function ExerciseDefinitionEditor({ definition, onClose, onSave }: {
  definition: ExerciseDefinition
  onClose: () => void
  onSave: (definition: ExerciseDefinition) => Promise<void>
}) {
  const [draft, setDraft] = useState({ ...definition, primaryMuscles: [...definition.primaryMuscles], secondaryMuscles: [...definition.secondaryMuscles] })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  function toggle(muscle: MuscleGroup, kind: 'primaryMuscles' | 'secondaryMuscles') {
    const other = kind === 'primaryMuscles' ? 'secondaryMuscles' : 'primaryMuscles'
    setDraft((current) => ({ ...current,
      [kind]: current[kind].includes(muscle) ? current[kind].filter((item) => item !== muscle) : [...current[kind], muscle],
      [other]: current[other].filter((item) => item !== muscle),
    }))
  }
  async function save() {
    try {
      validateDefinition(draft)
      setSaving(true)
      await onSave(draft)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '無法儲存動作')
    } finally { setSaving(false) }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="sheet editor-sheet" role="dialog" aria-modal="true" aria-label="編輯動作定義">
      <div className="sheet-header"><div><span className="eyebrow">EXERCISE LIBRARY</span><h2>{definition.name ? '編輯動作' : '建立動作'}</h2></div><button className="icon-button" onClick={onClose} aria-label="關閉"><X size={21} /></button></div>
      <div className="sheet-scroll editor-scroll">
        <div className="form-grid">
          <label className="form-field"><span>動作名稱</span><input value={draft.name} autoFocus placeholder="例如 臥推" onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label className="form-field"><span>器材</span><input value={draft.equipment} placeholder="例如 啞鈴，可自訂" onChange={(event) => setDraft({ ...draft, equipment: event.target.value })} /></label>
          <label className="form-field"><span>變化</span><input value={draft.variation} placeholder="例如 上斜，可留空" onChange={(event) => setDraft({ ...draft, variation: event.target.value })} /></label>
        </div>
        {(['primaryMuscles', 'secondaryMuscles'] as const).map((kind) => <section className="muscle-editor-section" key={kind}>
          <h3>{kind === 'primaryMuscles' ? '主要肌群' : '次要肌群'}</h3>
          <div className="muscle-chip-grid">{MUSCLE_GROUPS.map((muscle) => <button key={muscle} type="button" className={draft[kind].includes(muscle) ? 'selected' : ''} aria-pressed={draft[kind].includes(muscle)} onClick={() => toggle(muscle, kind)}>{MUSCLE_LABELS[muscle]}</button>)}</div>
        </section>)}
        {draft.primaryMuscles.length === 0 && draft.secondaryMuscles.length === 0 && <p className="field-hint">未設定肌群；之後可再分類。</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <div className="sheet-footer"><button className="primary-button" disabled={saving} onClick={() => void save()}><Check size={19} /> 儲存動作</button></div>
    </div>
  </div>
}

export function ExercisePicker({ definitions, onSelect, onCreate }: {
  definitions: ExerciseDefinition[]
  onSelect: (definition: ExerciseDefinition) => void
  onCreate: () => void
}) {
  const [query, setQuery] = useState('')
  const matches = definitions.filter((definition) => !definition.archived && definitionLabel(definition).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <div className="exercise-select-panel">
    <input aria-label="搜尋動作庫" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋動作名稱、器材或變化" />
    <div className="exercise-select-results">{matches.map((definition) => <button key={definition.id} onClick={() => onSelect(definition)}><strong>{definition.name}</strong><small>{definitionSubtitle(definition)}</small><ChevronRight size={17} /></button>)}{matches.length === 0 && <p>找不到動作，可以建立一個。</p>}</div>
    <button className="add-exercise-button" onClick={onCreate}><Plus size={18} /> 建立新動作</button>
  </div>
}

export function ExerciseLibrary({ definitions, routines, sessions, onBack, onSave, onArchive, onMerge }: {
  definitions: ExerciseDefinition[]
  routines: Routine[]
  sessions: WorkoutSession[]
  onBack: () => void
  onSave: (definition: ExerciseDefinition) => Promise<void>
  onArchive: (id: string, archived: boolean) => Promise<void>
  onMerge: (sourceId: string, targetId: string) => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [equipment, setEquipment] = useState('')
  const [muscle, setMuscle] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<ExerciseDefinition | null>(null)
  const [mergeSource, setMergeSource] = useState<ExerciseDefinition | null>(null)
  const [mergeTargetId, setMergeTargetId] = useState('')
  const [error, setError] = useState('')
  const equipmentOptions = useMemo(() => [...new Set(definitions.map((item) => item.equipment).filter(Boolean))].sort(), [definitions])
  const visible = definitions.filter((definition) =>
    (showArchived || !definition.archived) &&
    definitionLabel(definition).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) &&
    (!equipment || definition.equipment === equipment) &&
    (!muscle || [...definition.primaryMuscles, ...definition.secondaryMuscles].includes(muscle as MuscleGroup)))
  async function confirmMerge() {
    if (!mergeSource || !mergeTargetId || mergeSource.id === mergeTargetId) return
    const target = definitions.find((item) => item.id === mergeTargetId)
    if (!target) return
    const routineCount = routines.filter((routine) => routine.exercises.some((exercise) => exercise.exerciseDefinitionId === mergeSource.id)).length
    const sessionCount = sessions.filter((session) => session.exercises.some((exercise) => exercise.exerciseDefinitionId === mergeSource.id)).length
    if (!window.confirm(`這會把 ${sessionCount} 筆歷史／訓練紀錄與 ${routineCount} 份菜單合併到「${definitionLabel(target)}」。舊紀錄顯示名稱仍保留。確定合併？`)) return
    try {
      await onMerge(mergeSource.id, target.id)
      setMergeSource(null)
      setMergeTargetId('')
      setError('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '無法合併動作') }
  }
  return <main className="page page-with-nav"><div className="content-wrap">
    <header className="detail-topbar"><button className="icon-button" onClick={onBack} aria-label="返回設定"><ArrowLeft size={22} /></button><span>全域動作庫</span><button className="text-action" onClick={() => setEditing(newDefinition())}><Plus size={16} /> 新增</button></header>
    <div className="page-title"><span className="eyebrow">EXERCISE LIBRARY</span><h1>動作庫<span className="title-dot">.</span></h1><p>同一動作跨菜單共用紀錄；不同器材與變化分開追蹤。</p></div>
    <div className="library-filters"><input aria-label="搜尋動作" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋名稱、器材、變化" />
      <select aria-label="篩選器材" value={equipment} onChange={(event) => setEquipment(event.target.value)}><option value="">全部器材</option>{equipmentOptions.map((item) => <option key={item}>{item}</option>)}</select>
      <select aria-label="篩選肌群" value={muscle} onChange={(event) => setMuscle(event.target.value)}><option value="">全部肌群</option>{MUSCLE_GROUPS.map((item) => <option key={item} value={item}>{MUSCLE_LABELS[item]}</option>)}</select>
      <label className="archive-filter"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> 顯示已封存</label>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="library-list">{visible.map((definition) => <article className="library-card" key={definition.id}>
      <div><h2>{definition.name}</h2><p>{definitionSubtitle(definition)}{definition.archived && ' · 已封存'}</p></div>
      <div className="library-muscles">{definition.primaryMuscles.length ? <span>主要：{definition.primaryMuscles.map((item) => MUSCLE_LABELS[item]).join('、')}</span> : <span>未設定肌群</span>}{definition.secondaryMuscles.length > 0 && <span>次要：{definition.secondaryMuscles.map((item) => MUSCLE_LABELS[item]).join('、')}</span>}</div>
      <div className="library-actions"><button onClick={() => setEditing(definition)}>編輯</button><button onClick={() => void onArchive(definition.id, !definition.archived).catch((reason) => setError(reason instanceof Error ? reason.message : '無法更新封存狀態'))}>{definition.archived ? '取消封存' : '封存'}</button><button onClick={() => { setMergeSource(definition); setMergeTargetId('') }}>合併動作</button></div>
    </article>)}{visible.length === 0 && <p className="library-empty">目前沒有符合條件的動作。</p>}</div>
    {editing && <ExerciseDefinitionEditor definition={editing} onClose={() => setEditing(null)} onSave={async (definition) => { await onSave(definition); setEditing(null) }} />}
    {mergeSource && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setMergeSource(null)}><div className="sheet small-sheet" role="dialog" aria-modal="true" aria-label="合併動作">
      <div className="sheet-header"><div><span className="eyebrow">MERGE EXERCISE</span><h2>合併動作</h2></div><button className="icon-button" onClick={() => setMergeSource(null)} aria-label="關閉"><X size={21} /></button></div>
      <div className="sheet-scroll"><p>來源：{definitionLabel(mergeSource)}</p><label className="form-field"><span>合併到</span><select value={mergeTargetId} onChange={(event) => setMergeTargetId(event.target.value)}><option value="">選擇目標動作</option>{definitions.filter((item) => item.id !== mergeSource.id).map((item) => <option key={item.id} value={item.id}>{definitionLabel(item)}</option>)}</select></label><p className="field-hint">合併後來源會封存，過去訓練的名稱與器材快照不變。</p></div>
      <div className="sheet-footer"><button className="primary-button" disabled={!mergeTargetId} onClick={() => void confirmMerge()}>檢查影響範圍並合併</button></div>
    </div></div>}
  </div></main>
}
