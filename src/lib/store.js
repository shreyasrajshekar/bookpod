// Library lives in IndexedDB (books can be large); small prefs live in localStorage.
const DB = 'bookpod'
const STORE = 'books'

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx(mode, fn) {
  const db = await open()
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const out = fn(t.objectStore(STORE))
    t.oncomplete = () => resolve(out.result)
    t.onerror = () => reject(t.error)
  })
}

export const listBooks = async () => ((await tx('readonly', (s) => s.getAll())) || []).sort((a, b) => a.addedAt - b.addedAt)
export const saveBook = (book) => tx('readwrite', (s) => s.put(book))
export const deleteBook = (id) => tx('readwrite', (s) => s.delete(id))

const read = (k, d) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d }
}
const write = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private mode */ }
}
export const getProgress = (id) => read(`bookpod:progress:${id}`, { ch: 0, p: 0 })
export const setProgress = (id, v) => write(`bookpod:progress:${id}`, v)
export const getPrefs = () => ({ rate: 1, mode: 'full', voice: '', hostVoice: '', ...read('bookpod:prefs', {}) })
export const setPrefs = (v) => write('bookpod:prefs', v)
export const wasSeeded = () => read('bookpod:seeded', false)
export const markSeeded = () => write('bookpod:seeded', true)
