import { speechChunks } from './textBook.js'

export const supported = typeof window !== 'undefined' && 'speechSynthesis' in window

export function getVoices() {
  return new Promise((resolve) => {
    if (!supported) return resolve([])
    const have = speechSynthesis.getVoices()
    if (have.length) return resolve(have)
    const done = () => resolve(speechSynthesis.getVoices())
    speechSynthesis.addEventListener('voiceschanged', done, { once: true })
    setTimeout(done, 1200)
  })
}

const score = (v) =>
  (/natural|neural/i.test(v.name) ? 8 : 0) +
  (/online|premium|enhanced|siri/i.test(v.name) ? 5 : 0) +
  (/google|samantha|daniel|serena|aria|jenny|guy|ryan|libby|sonia|ava|allison|oliver/i.test(v.name) ? 2 : 0) +
  (/^en-(us|gb)/i.test(v.lang) ? 1 : 0) +
  (v.localService ? 0 : 1) -
  (/espeak|compact|novelty|bad news|bells|boing|cellos|zarvox|whisper|trinoids|organ|albert|junior|ralph|fred/i.test(v.name) ? 20 : 0)

export const voiceTier = (v) => (score(v) >= 8 ? 'Natural' : score(v) >= 4 ? 'Good' : 'Basic')

export function englishVoices(voices) {
  return voices.filter((v) => /^en/i.test(v.lang)).sort((a, b) => score(b) - score(a))
}

/** Say a short sample with a device voice (used by the Voices panel). */
export function previewDevice(voice, rate = 1) {
  if (!supported) return
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance('It was the best of times, it was the worst of times.')
  if (voice) { u.voice = voice; u.lang = voice.lang }
  u.rate = rate
  speechSynthesis.speak(u)
}

export const hostIntro = (book, ch, mins) =>
  `You're listening to BookPod. ${book.title}, by ${book.author}. ${ch.title}. About ${mins} ${mins === 1 ? 'minute' : 'minutes'}. Settle in.`

export const hostOutro = (ch, next) =>
  next ? `That was ${ch.title}. Coming up next: ${next.title}.` : `And that is the end of ${ch.title}. Thank you for listening.`

/**
 * Plays an episode as a queue of utterances. The host voice frames each chapter;
 * the narrator voice reads the paragraphs. Every item knows which paragraph it belongs to
 * so the page can highlight and the reader can seek.
 *
 * Two backends: 'device' (speechSynthesis) and 'audio' (neural or cloud clips, synthesised a few
 * chunks ahead and played through an <audio> element).
 */
export class Engine {
  constructor(handlers) {
    this.h = handlers
    this.items = []
    this.i = 0
    this.token = 0
    this.playing = false
    this.rate = 1
    this.backend = 'device' // 'device' | 'audio' (neural/cloud clips played via <audio>)
    this.synthesize = null // (text, voiceId) => Promise<objectUrl>
    this.narrator = null // SpeechSynthesisVoice
    this.host = null
    this.audioNarrator = ''
    this.audioHost = ''
    this.audio = null
    this.cache = new Map()
  }

  load({ intro, paragraphs, outro, startPara = 0 }) {
    const items = []
    if (intro) items.push({ text: intro, host: true, para: -1 })
    paragraphs.forEach((p, para) => {
      speechChunks(p).forEach((text) => items.push({ text, host: false, para }))
    })
    if (outro) items.push({ text: outro, host: true, para: paragraphs.length })
    this.items = items
    this.i = 0
    this.clearCache()
    if (startPara > 0) this.i = Math.max(0, items.findIndex((it) => !it.host && it.para >= startPara))
  }

  clearCache() {
    for (const p of this.cache.values()) p.then((u) => URL.revokeObjectURL(u)).catch(() => {})
    this.cache.clear()
  }

  start() {
    if (this.backend === 'device' && !supported) return
    this.playing = true
    this.speak()
  }

  speak() {
    const token = ++this.token
    this.stopAudio()
    if (supported) speechSynthesis.cancel()
    const item = this.items[this.i]
    if (!item) {
      this.playing = false
      this.h.onEnd?.()
      return
    }
    this.h.onItem?.(item)
    const next = () => {
      if (token !== this.token) return
      this.i++
      this.speak()
    }
    if (this.backend === 'audio') return this.speakStudio(item, token, next)

    const u = new SpeechSynthesisUtterance(item.text)
    const voice = item.host ? this.host || this.narrator : this.narrator
    if (voice) { u.voice = voice; u.lang = voice.lang }
    u.rate = Math.min(2, this.rate * (item.host ? 1.02 : 1))
    u.pitch = item.host ? 1.08 : 1
    u.onend = next
    u.onerror = (e) => {
      if (token !== this.token || e.error === 'canceled' || e.error === 'interrupted') return
      next()
    }
    // Chrome silently drops a few utterances if speak() runs in the same tick as cancel().
    setTimeout(() => token === this.token && speechSynthesis.speak(u), 30)
  }

  audioFor(idx) {
    const item = this.items[idx]
    if (!item) return null
    const voice = item.host ? this.audioHost : this.audioNarrator
    const key = voice + '|' + item.text
    if (!this.cache.has(key)) this.cache.set(key, this.synthesize(item.text, voice))
    return { key, promise: this.cache.get(key) }
  }

  async speakStudio(item, token, next) {
    const cur = this.audioFor(this.i)
    this.h.onBuffering?.(true)
    let url
    try {
      url = await cur.promise
    } catch (e) {
      this.cache.delete(cur.key)
      this.h.onBuffering?.(false)
      if (token === this.token) this.h.onError?.(e)
      return
    }
    if (token !== this.token) return
    this.h.onBuffering?.(false)
    // Keep two chunks of synthesis running ahead, and free what we've already played.
    const keep = new Set([cur.key])
    for (const n of [1, 2]) { const a = this.audioFor(this.i + n); if (a) keep.add(a.key) }
    for (const [k, p] of this.cache) {
      if (!keep.has(k) && this.cache.size > 6) { this.cache.delete(k); p.then((u) => URL.revokeObjectURL(u)).catch(() => {}) }
    }
    const a = new Audio(url)
    a.playbackRate = this.rate
    a.preservesPitch = true
    a.onended = next
    a.onerror = next
    this.audio = a
    try { await a.play() } catch { /* autoplay blocked: user will press play */ }
  }

  stopAudio() {
    if (this.audio) {
      this.audio.onended = this.audio.onerror = null
      this.audio.pause()
      this.audio = null
    }
  }

  pause() {
    this.playing = false
    if (this.backend === 'audio' && this.audio && !this.audio.ended) {
      this.audio.pause() // keep position; resume() continues mid-sentence
      return
    }
    this.token++ // detach pending callbacks
    this.stopAudio()
    if (supported) speechSynthesis.cancel()
  }

  resume() {
    if (!this.items.length) return
    this.playing = true
    if (this.backend === 'audio' && this.audio && this.audio.paused) {
      this.audio.play()
      return
    }
    this.speak() // device: restart the current sentence; reliable across browsers
  }

  skipToPara(para) {
    const idx = this.items.findIndex((it) => !it.host && it.para >= para)
    this.i = idx === -1 ? this.items.length : idx
    if (this.playing) this.speak()
    else this.stopAudio()
  }

  setRate(r) {
    this.rate = r
    if (this.audio) this.audio.playbackRate = r
    else if (this.playing) this.speak()
  }

  stop() {
    this.playing = false
    this.token++
    this.stopAudio()
    if (supported) speechSynthesis.cancel()
    this.items = []
    this.clearCache()
  }
}
