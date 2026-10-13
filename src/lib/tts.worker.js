// One Piper neural voice, running off the main thread so the page never freezes while speech is generated.
// One worker = one voice, so the narrator and the host each get their own worker.
//
// Pieces: piper-phonemize (WASM, text → phoneme ids) + onnxruntime-web (the voice model) + Cache API (model files).
// The phonemizer glue is emscripten output that peeks at the DOM; give it an empty one.
self.window = self
self.document = self.document || { currentScript: { src: self.location.href }, baseURI: self.location.href, querySelectorAll: () => [], querySelector: () => null, getElementsByTagName: () => [] }

const HF = 'https://huggingface.co/diffusionstudio/piper-voices/resolve/main'
const PHONEMIZE = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize'
const ORT_WASM = 'https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.18.0/'

const modelUrl = (id) => {
  const [region, name, quality] = id.split('-')
  return `${HF}/${region.slice(0, 2)}/${region}/${name}/${quality}/${id}`
}

let state = null // { ort, cfg, session, phonemize }
let loading = null
let queue = Promise.resolve()

async function cached(url, onProgress) {
  const cache = await caches.open('bookpod-voices-v1').catch(() => null)
  const hit = cache && (await cache.match(url))
  if (hit) return hit.arrayBuffer()
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Couldn’t download the voice (${res.status}).`)
  const total = Number(res.headers.get('content-length')) || 0
  const reader = res.body.getReader()
  const parts = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    loaded += value.length
    if (total) onProgress?.(Math.min(1, loaded / total))
  }
  const blob = new Blob(parts)
  cache?.put(url, new Response(blob)).catch(() => {})
  return blob.arrayBuffer()
}

async function load(voiceId, onProgress) {
  if (state) return state
  if (!loading) {
    loading = (async () => {
      const base = modelUrl(voiceId)
      const ort = await import('onnxruntime-web/wasm')
      ort.env.wasm.wasmPaths = ORT_WASM
      // Several threads need SharedArrayBuffer, i.e. cross-origin isolation (see vercel.json); otherwise one.
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, Math.max(1, Math.floor((navigator.hardwareConcurrency || 2) / 2))) : 1
      const cfg = JSON.parse(new TextDecoder().decode(await cached(base + '.onnx.json')))
      const session = await ort.InferenceSession.create(await cached(base + '.onnx', onProgress), { executionProviders: ['wasm'] })
      const { createPiperPhonemize } = await import('../../node_modules/@mintplex-labs/piper-tts-web/dist/piper-o91UDS6e.js')
      state = { ort, cfg, session, createPiperPhonemize }
      return state
    })().catch((e) => {
      loading = null
      throw e
    })
  }
  return loading
}

// The phonemizer module is expensive to create (WASM + ~20 MB of espeak data), so create it once and reuse it.
let phonemizer = null
let pending = null // { resolve, reject } of the call in flight

async function getPhonemizer() {
  if (!phonemizer) {
    phonemizer = state.createPiperPhonemize({
      print: (data) => pending?.resolve(JSON.parse(data).phoneme_ids),
      printErr: (msg) => pending?.reject(new Error(msg)),
      locateFile: (url) => (url.endsWith('.wasm') ? PHONEMIZE + '.wasm' : url.endsWith('.data') ? PHONEMIZE + '.data' : url),
    }).catch((e) => {
      phonemizer = null
      throw e
    })
  }
  return phonemizer
}

async function phonemeIds(text) {
  const mod = await getPhonemizer()
  return new Promise((resolve, reject) => {
    pending = { resolve, reject }
    try {
      mod.callMain(['-l', state.cfg.espeak.voice, '--input', JSON.stringify([{ text: text.trim() }]), '--espeak_data', '/espeak-ng-data'])
    } catch (e) {
      phonemizer = null // a module that has exited can't be reused; build a fresh one next time
      reject(e)
    }
  })
}

function wav(pcm, rate) {
  const buf = new ArrayBuffer(44 + pcm.length * 2)
  const v = new DataView(buf)
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVEfmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  w(36, 'data'); v.setUint32(40, pcm.length * 2, true)
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 32767, true)
  return new Blob([buf], { type: 'audio/wav' })
}

async function synth(text) {
  const { ort, cfg, session } = state
  const ids = await phonemeIds(text)
  const feeds = {
    input: new ort.Tensor('int64', ids, [1, ids.length]),
    input_lengths: new ort.Tensor('int64', [ids.length]),
    scales: new ort.Tensor('float32', [cfg.inference.noise_scale, cfg.inference.length_scale, cfg.inference.noise_w]),
  }
  if (Object.keys(cfg.speaker_id_map || {}).length) feeds.sid = new ort.Tensor('int64', [0])
  const { output } = await session.run(feeds)
  return wav(output.data, cfg.audio.sample_rate)
}

// Jobs run strictly one at a time.
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      if (data.type === 'load') {
        await load(data.voice, (value) => postMessage({ type: 'progress', value }))
        await synth('Ready.') // warm the phonemizer now, not on the first sentence
        postMessage({ type: 'ready' })
      } else if (data.type === 'synth') {
        await load(data.voice)
        const t0 = performance.now()
        let blob
        try { blob = await synth(data.text) } catch { blob = await synth(data.text) } // one retry with a fresh phonemizer
        postMessage({ type: 'audio', id: data.id, blob, ms: Math.round(performance.now() - t0) })
      }
    } catch (e) {
      postMessage({ type: 'error', id: data.id, message: String(e?.message || e) })
    }
  })
}
