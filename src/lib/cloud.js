// "Premium voices": Google Cloud Text-to-Speech.
//  • own key  – the listener's key, stored in this browser, calls go straight to Google.
//  • included – the site owner's key lives on the server (/api/tts); the browser never sees it.
const GOOGLE = 'https://texttospeech.googleapis.com/v1'
const CFG = 'bookpod:cloud'

export const DEFAULT_CLOUD = { narrator: 'en-US-Chirp3-HD-Aoede', host: 'en-US-Chirp3-HD-Charon' }

export function getCloudConfig() {
  try { return { mode: 'own', key: '', code: '', ...JSON.parse(localStorage.getItem(CFG)) } } catch { return { mode: 'own', key: '', code: '' } }
}
export function setCloudConfig(patch) {
  const next = { ...getCloudConfig(), ...patch }
  try { localStorage.setItem(CFG, JSON.stringify(next)) } catch { /* private mode */ }
  return next
}

/** Does this deployment have a server-side key, and does it need an access code? */
export async function serverStatus() {
  try {
    const r = await fetch('/api/tts')
    if (!r.ok) return { enabled: false }
    const j = await r.json()
    return { enabled: !!j.enabled, needsCode: !!j.needsCode }
  } catch {
    return { enabled: false }
  }
}

export const cloudReady = (cfg, server) => (cfg.mode === 'included' ? !!server?.enabled : !!cfg.key)

class CloudError extends Error {}

async function explain(res) {
  let detail = ''
  try { detail = (await res.json())?.error?.message || '' } catch { /* not json */ }
  if (res.status === 400 && /API key not valid/i.test(detail)) return 'Google says that API key is not valid.'
  if (res.status === 403) return 'Google refused the request. Make sure the Cloud Text-to-Speech API is enabled for this key and the key is allowed on this site.'
  if (res.status === 429) return 'Google’s quota for this key has been used up for now.'
  if (res.status === 401) return 'The access code is missing or wrong.'
  return detail || `Voice request failed (${res.status}).`
}

const tier = (n) => (/Chirp3-HD/i.test(n) ? 0 : /Studio/i.test(n) ? 1 : /Neural2/i.test(n) ? 2 : /Journey/i.test(n) ? 1 : 9)
const nice = (n) => {
  const m = n.match(/^(en-[A-Z]{2})-(Chirp3-HD|Studio|Neural2|Journey)-(\w+)$/)
  if (!m) return n
  const kind = { 'Chirp3-HD': 'Chirp 3 HD', Studio: 'Studio', Neural2: 'Neural2', Journey: 'Journey' }[m[2]]
  return `${m[3]} · ${kind} · ${m[1]}`
}

/** Premium English voices, best first. */
export async function listCloudVoices(cfg) {
  const url = cfg.mode === 'included' ? '/api/tts?voices=1' : `${GOOGLE}/voices?languageCode=en&key=${encodeURIComponent(cfg.key)}`
  const res = await fetch(url, cfg.mode === 'included' ? { headers: cfg.code ? { 'x-access-code': cfg.code } : {} } : {})
  if (!res.ok) throw new CloudError(await explain(res))
  const { voices = [] } = await res.json()
  return voices
    .filter((v) => tier(v.name) < 9 && /^en-(US|GB|AU|IN)/.test(v.name))
    .map((v) => ({ id: v.name, label: nice(v.name), gender: v.ssmlGender, tier: tier(v.name) }))
    .sort((a, b) => a.tier - b.tier || a.label.localeCompare(b.label))
}

async function cacheOpen() {
  try { return await caches.open('bookpod-tts-v1') } catch { return null }
}
async function keyFor(text, voice) {
  const data = new TextEncoder().encode(voice + '\n' + text)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return 'https://bookpod.local/tts/' + [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const b64ToBlob = (b64) => {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: 'audio/mpeg' })
}

/** Synthesize one chunk. Audio is cached on-device so replays are free. */
export async function synthCloud(text, voice) {
  const cfg = getCloudConfig()
  const cache = await cacheOpen()
  const key = cache && (await keyFor(text, voice))
  const hit = cache && (await cache.match(key))
  if (hit) return URL.createObjectURL(await hit.blob())

  const lang = voice.split('-').slice(0, 2).join('-')
  const body = { input: { text }, voice: { languageCode: lang, name: voice }, audioConfig: { audioEncoding: 'MP3' } }
  const res =
    cfg.mode === 'included'
      ? await fetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json', ...(cfg.code ? { 'x-access-code': cfg.code } : {}) }, body: JSON.stringify({ text, voice }) })
      : await fetch(`${GOOGLE}/text:synthesize?key=${encodeURIComponent(cfg.key)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new CloudError(await explain(res))
  const blob = b64ToBlob((await res.json()).audioContent)
  if (cache) cache.put(key, new Response(blob, { headers: { 'content-type': 'audio/mpeg' } })).catch(() => {})
  return URL.createObjectURL(blob)
}
