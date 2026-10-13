import { speechChunks } from './textBook.js'
import { synth } from './studio.js'

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty']

function romanToInt(r) {
  const v = { I: 1, V: 5, X: 10, L: 50, C: 100 }
  let n = 0
  for (let i = 0; i < r.length; i++) {
    const cur = v[r[i]], nxt = v[r[i + 1]]
    if (!cur) return NaN
    n += nxt > cur ? -cur : cur
  }
  return n
}
const words = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''))

/** "Chapter IV — The Rabbit" → "Chapter four, The Rabbit": roman numerals are read as numbers, dashes as pauses. */
export function speakable(title) {
  return title
    .replace(/\b(Chapter|Stave|Book|Part|Section|Act|Scene|Canto|Letter)\s+([IVXLC]+)\b/g, (m, kind, r) => {
      const n = romanToInt(r)
      return n >= 1 && n < 60 ? `${kind} ${words(n)}` : m
    })
    .replace(/\s*[—·]\s*/g, ', ')
}

export const hostIntro = (book, ch, mins) =>
  `You're listening to BookPod. ${book.title}, by ${book.author}. ${speakable(ch.title)}. About ${mins} ${mins === 1 ? 'minute' : 'minutes'}. Settle in.`

export const hostOutro = (ch, next) =>
  next ? `That was ${speakable(ch.title)}. Coming up next: ${speakable(next.title)}.` : `And that is the end of ${speakable(ch.title)}. Thank you for listening.`

const AHEAD = 3 // clips synthesised in advance of the one playing

/**
 * Plays an episode as a queue of clips. The host voice frames each chapter, the narrator reads the
 * paragraphs. Every clip knows which paragraph it belongs to, so the page can highlight and seek.
 * Synthesis happens in a worker a few clips ahead, so playback stays smooth and the page stays responsive.
 */
export class Engine {
  constructor(handlers) {
    this.h = handlers
    this.items = []
    this.i = 0
    this.token = 0
    this.playing = false
    this.rate = 1
    this.narrator = 'en_US-lessac-medium'
    this.host = 'en_US-ryan-medium'
    this.audio = null
    this.cache = new Map()
  }

  load({ intro, paragraphs, outro, startPara = 0 }) {
    const items = []
    if (intro) items.push({ text: intro, host: true, para: -1 })
    paragraphs.forEach((p, para) => speechChunks(p, 240).forEach((text) => items.push({ text, host: false, para })))
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
    this.playing = true
    this.speak()
  }

  clip(idx) {
    const item = this.items[idx]
    if (!item) return null
    const voice = item.host ? this.host : this.narrator
    const key = voice + '|' + item.text
    if (!this.cache.has(key)) {
      const p = synth(item.text, voice)
      p.catch(() => this.cache.delete(key)) // allow a retry
      this.cache.set(key, p)
    }
    return { key, promise: this.cache.get(key) }
  }

  async speak() {
    const token = ++this.token
    this.stopAudio()
    const item = this.items[this.i]
    if (!item) {
      this.playing = false
      this.h.onEnd?.()
      return
    }
    this.h.onItem?.(item)
    const cur = this.clip(this.i)
    // Queue the next few clips right away so the worker is never idle while we play.
    const keep = new Set([cur.key])
    for (let n = 1; n <= AHEAD; n++) { const c = this.clip(this.i + n); if (c) keep.add(c.key) }

    let url
    let waited = false
    const t = setTimeout(() => { waited = true; this.h.onBuffering?.(true) }, 250)
    try {
      url = await cur.promise
    } catch (e) {
      clearTimeout(t)
      this.h.onBuffering?.(false)
      if (token === this.token) this.h.onError?.(e)
      return
    }
    clearTimeout(t)
    if (waited) this.h.onBuffering?.(false)
    if (token !== this.token) return

    // Free clips we've moved past.
    for (const [k, p] of this.cache) {
      if (!keep.has(k) && this.cache.size > AHEAD + 4) { this.cache.delete(k); p.then((u) => URL.revokeObjectURL(u)).catch(() => {}) }
    }
    const next = () => {
      if (token !== this.token) return
      this.i++
      this.speak()
    }
    const a = new Audio(url)
    a.defaultPlaybackRate = this.rate // media load resets playbackRate to this, so set both
    a.playbackRate = this.rate
    a.preservesPitch = true
    a.onended = next
    a.onerror = next
    this.audio = a
    a.play().catch(() => {})
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
    if (this.audio && !this.audio.ended) {
      this.audio.pause() // keep position; resume() continues mid-sentence
      return
    }
    this.token++
  }

  resume() {
    if (!this.items.length) return
    this.playing = true
    if (this.audio && this.audio.paused) this.audio.play()
    else this.speak()
  }

  skipToPara(para) {
    const idx = this.items.findIndex((it) => !it.host && it.para >= para)
    this.i = idx === -1 ? this.items.length : idx
    if (this.playing) this.speak()
    else { this.token++; this.stopAudio() }
  }

  setRate(r) {
    this.rate = r
    if (this.audio) this.audio.defaultPlaybackRate = this.audio.playbackRate = r
  }

  stop() {
    this.playing = false
    this.token++
    this.stopAudio()
    this.items = []
    this.clearCache()
  }
}
