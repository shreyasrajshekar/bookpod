// "Studio voices": Kokoro-82M neural TTS running on-device via transformers.js.
// The model (~90 MB, quantised) is fetched once from Hugging Face and cached by the browser.
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX'

let ttsPromise = null
let ttsInstance = null

export const studioReady = () => !!ttsInstance

/** Curated, best-graded voices first. Ids are Kokoro voice ids. */
export const STUDIO_VOICES = [
  { id: 'af_heart', label: 'Heart — warm, American woman', grade: 'A' },
  { id: 'af_bella', label: 'Bella — bright, American woman', grade: 'A-' },
  { id: 'bf_emma', label: 'Emma — refined, British woman', grade: 'B-' },
  { id: 'af_nicole', label: 'Nicole — soft, American woman', grade: 'B-' },
  { id: 'am_michael', label: 'Michael — steady, American man', grade: 'C+' },
  { id: 'am_fenrir', label: 'Fenrir — deep, American man', grade: 'C+' },
  { id: 'am_puck', label: 'Puck — playful, American man', grade: 'C+' },
  { id: 'bm_george', label: 'George — classic, British man', grade: 'C' },
  { id: 'bm_fable', label: 'Fable — storyteller, British man', grade: 'C' },
  { id: 'bf_isabella', label: 'Isabella — British woman', grade: 'C' },
  { id: 'af_kore', label: 'Kore — American woman', grade: 'C+' },
  { id: 'af_sarah', label: 'Sarah — American woman', grade: 'C+' },
  { id: 'af_aoede', label: 'Aoede — American woman', grade: 'C+' },
]

export const DEFAULT_STUDIO = { narrator: 'af_heart', host: 'am_michael' }

/** Load (once). onProgress receives 0..1 while downloading. Throws if the device can't run it. */
export function loadStudio(onProgress) {
  if (ttsPromise) return ttsPromise
  ttsPromise = (async () => {
    const { KokoroTTS } = await import('kokoro-js')
    const files = new Map()
    const progress_callback = (p) => {
      if (p.status === 'progress' && p.file) {
        files.set(p.file, p)
        let loaded = 0, total = 0
        for (const f of files.values()) { loaded += f.loaded || 0; total += f.total || 0 }
        if (total) onProgress?.(Math.min(1, loaded / total))
      }
    }
    ttsInstance = await KokoroTTS.from_pretrained(MODEL, { dtype: 'q8', device: 'wasm', progress_callback })
    return ttsInstance
  })().catch((e) => {
    ttsPromise = null
    ttsInstance = null
    throw e
  })
  return ttsPromise
}

/** Synthesize one chunk to an object URL for an <audio> element. */
export async function synth(text, voice) {
  const tts = await loadStudio()
  const audio = await tts.generate(text, { voice })
  return URL.createObjectURL(audio.toBlob())
}
