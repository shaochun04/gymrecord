import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { IndexedDbWorkoutRepository } from './data/indexedDbWorkoutRepository'
import './styles.css'

async function start() {
  try {
    const repository = new IndexedDbWorkoutRepository()
    await repository.initialize()
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode><App repository={repository} /></React.StrictMode>,
    )
    registerSW({ immediate: true })
  } catch (error) {
    document.getElementById('root')!.innerHTML = `<div class="boot-error"><h1>無法載入紀錄</h1><p>請確認瀏覽器允許本機儲存，然後重新整理頁面。</p><pre>${String(error).replaceAll('<', '&lt;')}</pre></div>`
  }
}

void start()
