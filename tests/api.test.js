import { test } from 'node:test'
import assert from 'node:assert/strict'
import handler from '../api/tts.js'

const call = async (method, url, { body, headers = {} } = {}) => {
  const req = { method, url, headers: { host: 'bookpod.test', ...headers }, body, socket: { remoteAddress: '1.2.3.4' } }
  let out = {}
  const res = { setHeader() {}, end(s) { out.body = JSON.parse(s) }, set statusCode(v) { out.status = v } }
  await handler(req, res)
  return out
}

test('reports disabled without a key', async () => {
  delete process.env.GOOGLE_TTS_API_KEY
  assert.deepEqual((await call('GET', '/api/tts')).body, { enabled: false, needsCode: false })
  assert.equal((await call('POST', '/api/tts', { body: { text: 'hi', voice: 'en-US-Chirp3-HD-Aoede' } })).status, 503)
})

test('validates, proxies and limits', async () => {
  process.env.GOOGLE_TTS_API_KEY = 'secret'
  const seen = []
  globalThis.fetch = async (url, init) => { seen.push({ url, init }); return { ok: true, json: async () => ({ audioContent: 'QUJD' }) } }
  const good = { text: 'Hello there.', voice: 'en-US-Chirp3-HD-Aoede' }

  assert.equal((await call('POST', '/api/tts', { body: { ...good, voice: 'ja-JP-Wavenet-A' } })).status, 400)
  assert.equal((await call('POST', '/api/tts', { body: { ...good, text: 'x'.repeat(601) } })).status, 400)
  assert.equal((await call('POST', '/api/tts', { body: good, headers: { origin: 'https://evil.example' } })).status, 403)

  const ok = await call('POST', '/api/tts', { body: good, headers: { origin: 'https://bookpod.test' } })
  assert.equal(ok.status, 200)
  assert.equal(ok.body.audioContent, 'QUJD')
  assert.equal(seen[0].init.headers['x-goog-api-key'], 'secret')
  assert.ok(!JSON.stringify(ok.body).includes('secret'))

  process.env.TTS_IP_DAILY_CHARS = '20'
  assert.equal((await call('POST', '/api/tts', { body: good })).status, 429)
})

test('access code is enforced when configured', async () => {
  process.env.GOOGLE_TTS_API_KEY = 'secret'
  process.env.TTS_ACCESS_CODE = 'open-sesame'
  process.env.TTS_IP_DAILY_CHARS = '40000'
  const body = { text: 'Hi', voice: 'en-GB-Neural2-A' }
  assert.equal((await call('POST', '/api/tts', { body })).status, 401)
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ audioContent: 'QQ==' }) })
  assert.equal((await call('POST', '/api/tts', { body, headers: { 'x-access-code': 'open-sesame' } })).status, 200)
})
