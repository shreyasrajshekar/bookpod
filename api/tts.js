// Vercel serverless function: proxies Google Cloud Text-to-Speech so the API key never reaches the browser.
//
// Env vars
//   GOOGLE_TTS_API_KEY   required to enable "included" premium voices
//   TTS_ACCESS_CODE      optional; if set, callers must send it in the x-access-code header
//   TTS_IP_DAILY_CHARS   optional per-visitor daily character budget (default 40000)
//   TTS_DAILY_CHARS      optional per-instance daily character budget (default 400000)
//
// The limits below live in memory, so they are per serverless instance and approximate.
// For a hard spending cap, also set a quota on the Cloud Text-to-Speech API in Google Cloud Console.
const GOOGLE = 'https://texttospeech.googleapis.com/v1'
const MAX_CHARS = 600

const ipUse = new Map() // ip -> { day, chars, hits:[timestamps] }
let global = { day: '', chars: 0 }
let voiceCache = null

const today = () => new Date().toISOString().slice(0, 10)
const key = () => process.env.GOOGLE_TTS_API_KEY

function send(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function sameOrigin(req) {
  const o = req.headers.origin || req.headers.referer
  if (!o) return true // non-browser callers are still subject to limits and the access code
  try { return new URL(o).host === req.headers.host } catch { return false }
}

function limited(req, chars) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim()
  const day = today()
  if (global.day !== day) global = { day, chars: 0 }
  let u = ipUse.get(ip)
  if (!u || u.day !== day) u = { day, chars: 0, hits: [] }
  const now = Date.now()
  u.hits = u.hits.filter((t) => now - t < 60_000)
  if (u.hits.length >= 90) return 'Slow down a little: too many requests this minute.'
  if (u.chars + chars > Number(process.env.TTS_IP_DAILY_CHARS || 40000)) return 'Daily listening allowance reached for included voices. Try again tomorrow, or add your own key.'
  if (global.chars + chars > Number(process.env.TTS_DAILY_CHARS || 400000)) return 'Included voices have hit today’s limit. Try again tomorrow, or add your own key.'
  u.hits.push(now)
  u.chars += chars
  global.chars += chars
  ipUse.set(ip, u)
  if (ipUse.size > 5000) ipUse.clear()
  return null
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body
  let raw = ''
  for await (const c of req) { raw += c; if (raw.length > 10_000) throw new Error('too large') }
  return JSON.parse(raw || '{}')
}

export default async function handler(req, res) {
  const needsCode = !!process.env.TTS_ACCESS_CODE

  if (req.method === 'GET' && !req.url.includes('voices=1')) return send(res, 200, { enabled: !!key(), needsCode })
  if (!key()) return send(res, 503, { error: { message: 'Included voices are not configured on this site.' } })
  if (!sameOrigin(req)) return send(res, 403, { error: { message: 'Cross-site requests are not allowed.' } })
  if (needsCode && req.headers['x-access-code'] !== process.env.TTS_ACCESS_CODE) return send(res, 401, { error: { message: 'Access code required.' } })

  try {
    if (req.method === 'GET') {
      if (!voiceCache || Date.now() - voiceCache.at > 3_600_000) {
        const r = await fetch(`${GOOGLE}/voices?languageCode=en`, { headers: { 'x-goog-api-key': key() } })
        if (!r.ok) return send(res, r.status, await r.json().catch(() => ({ error: { message: 'Voice list failed' } })))
        voiceCache = { at: Date.now(), data: await r.json() }
      }
      return send(res, 200, voiceCache.data)
    }

    if (req.method !== 'POST') return send(res, 405, { error: { message: 'Method not allowed' } })
    const { text, voice } = await readJson(req)
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_CHARS) return send(res, 400, { error: { message: `Text must be 1–${MAX_CHARS} characters.` } })
    if (typeof voice !== 'string' || !/^en-(US|GB|AU|IN)-(Chirp3-HD|Studio|Neural2|Journey)-[A-Za-z0-9]+$/.test(voice)) return send(res, 400, { error: { message: 'Unsupported voice.' } })
    const why = limited(req, text.length)
    if (why) return send(res, 429, { error: { message: why } })

    const r = await fetch(`${GOOGLE}/text:synthesize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key() },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: voice.split('-').slice(0, 2).join('-'), name: voice },
        audioConfig: { audioEncoding: 'MP3' },
      }),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) return send(res, r.status === 400 ? 502 : r.status, { error: { message: data?.error?.message || 'Voice service error' } })
    return send(res, 200, { audioContent: data.audioContent })
  } catch (e) {
    return send(res, 500, { error: { message: 'Voice service unavailable.' } })
  }
}
