// BookPod voices: Piper neural text-to-speech, running in Web Workers on the listener's device.
// Each voice downloads once (~60 MB) and is cached by the browser. No accounts, no API keys.

/** Curated voices. Ids are Piper voice ids. "HD" voices are larger and a touch slower but more natural. */
export const VOICES = [
  { id: 'en_US-lessac-medium', label: 'Lessac — clear, American' },
  { id: 'en_US-ryan-medium', label: 'Ryan — warm, American man' },
  { id: 'en_US-amy-medium', label: 'Amy — friendly, American woman' },
  { id: 'en_US-hfc_female-medium', label: 'Hazel — calm, American woman' },
  { id: 'en_US-hfc_male-medium', label: 'Hal — even, American man' },
  { id: 'en_US-joe-medium', label: 'Joe — relaxed, American man' },
  { id: 'en_US-kristin-medium', label: 'Kristin — bright, American woman' },
  { id: 'en_US-ljspeech-medium', label: 'Linda — audiobook, American woman' },
  { id: 'en_GB-alba-medium', label: 'Alba — Scottish woman' },
  { id: 'en_GB-cori-medium', label: 'Cori — British woman' },
  { id: 'en_GB-jenny_dioco-medium', label: 'Jenny — British woman' },
  { id: 'en_GB-northern_english_male-medium', label: 'Neil — Northern English man' },
  { id: 'en_GB-alan-medium', label: 'Alan — British man' },
  { id: 'en_US-ryan-high', label: 'Ryan HD — warm, American man (120 MB)' },
  { id: 'en_US-lessac-high', label: 'Lessac HD — clear, American (115 MB)' },
  { id: 'en_GB-cori-high', label: 'Cori HD — British woman (115 MB)' },
]

export const supported = typeof WebAssembly !== 'undefined' && typeof Worker !== 'undefined'

// One worker per voice. Narrator and host usually differ, so there are normally two.
const engines = new Map() // voiceId -> { worker, ready: Promise, progress: 0..1, isReady }
let nextId = 1
const pending = new Map()
let onProgress = null

export const voicesReady = (...ids) => ids.every((id) => engines.get(id)?.isReady)

function spawn(voice) {
  let e = engines.get(voice)
  if (e) return e
  const worker = new Worker(new URL('./tts.worker.js', import.meta.url), { type: 'module' })
  e = { worker, progress: 0, isReady: false }
  e.ready = new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') { e.progress = data.value; onProgress?.() }
      else if (data.type === 'ready') { e.isReady = true; e.progress = 1; onProgress?.(); resolve() }
      else if (data.type === 'audio') { pending.get(data.id)?.resolve(URL.createObjectURL(data.blob)); pending.delete(data.id) }
      else if (data.type === 'error') {
        if (data.id) { pending.get(data.id)?.reject(new Error(data.message)); pending.delete(data.id) }
        else reject(new Error(data.message))
      }
    }
    worker.onerror = (ev) => reject(new Error(ev.message || 'The voice engine crashed.'))
    worker.postMessage({ type: 'load', voice })
  }).catch((err) => {
    worker.terminate()
    engines.delete(voice)
    throw err
  })
  engines.set(voice, e)
  return e
}

/**
 * Make sure these voices are downloaded and ready; stop engines for voices no longer wanted.
 * progress() receives 0..1 averaged across the voices.
 */
export function loadVoices(ids, progress) {
  const wanted = [...new Set(ids)]
  for (const [id, e] of engines) if (!wanted.includes(id)) { e.worker.terminate(); engines.delete(id) }
  onProgress = () => progress?.(wanted.reduce((s, id) => s + (engines.get(id)?.progress || 0), 0) / wanted.length)
  return Promise.all(wanted.map((id) => spawn(id).ready)).then(() => undefined)
}

/** Synthesize one chunk of text with a (loaded) voice → object URL of a WAV clip. */
export function synth(text, voice) {
  const e = spawn(voice)
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    e.worker.postMessage({ type: 'synth', id, text, voice })
  })
}
