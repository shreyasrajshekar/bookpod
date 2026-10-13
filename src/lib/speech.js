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
  (/natural|neural|online|premium|enhanced/i.test(v.name) ? 6 : 0) +
  (/google|samantha|daniel|serena|aria|jenny|guy|ryan|libby|sonia/i.test(v.name) ? 2 : 0) +
  (v.localService ? 0 : 1)

export function englishVoices(voices) {
  return voices.filter((v) => /^en/i.test(v.lang)).sort((a, b) => score(b) - score(a))
}

export const hostIntro = (book, ch, mins) =>
  `You're listening to BookPod. ${book.title}, by ${book.author}. ${ch.title}. About ${mins} ${mins === 1 ? 'minute' : 'minutes'}. Settle in.`

export const hostOutro = (ch, next) =>
  next ? `That was ${ch.title}. Coming up next: ${next.title}.` : `And that is the end of ${ch.title}. Thank you for listening.`

/**
 * Plays an episode as a queue of utterances. The host voice frames each chapter;
 * the narrator voice reads the paragraphs. Every item knows which paragraph it belongs to
 * so the page can highlight and the reader can seek.
 */
export class Engine {
  constructor(handlers) {
    this.h = handlers
    this.items = []
    this.i = 0
    this.token = 0
    this.playing = false
    this.rate = 1
    this.narrator = null
    this.host = null
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
    if (startPara > 0) this.i = Math.max(0, items.findIndex((it) => !it.host && it.para >= startPara))
  }

  start() {
    if (!supported) return
    this.playing = true
    this.speak()
  }

  speak() {
    const token = ++this.token
    speechSynthesis.cancel()
    const item = this.items[this.i]
    if (!item) {
      this.playing = false
      this.h.onEnd?.()
      return
    }
    this.h.onItem?.(item)
    const u = new SpeechSynthesisUtterance(item.text)
    const voice = item.host ? this.host || this.narrator : this.narrator
    if (voice) { u.voice = voice; u.lang = voice.lang }
    u.rate = Math.min(2, this.rate * (item.host ? 1.02 : 1))
    u.pitch = item.host ? 1.08 : 1
    const next = () => {
      if (token !== this.token) return
      this.i++
      this.speak()
    }
    u.onend = next
    u.onerror = (e) => {
      if (token !== this.token || e.error === 'canceled' || e.error === 'interrupted') return
      next()
    }
    // Chrome silently drops a few utterances if speak() runs in the same tick as cancel().
    setTimeout(() => token === this.token && speechSynthesis.speak(u), 30)
  }

  pause() {
    this.playing = false
    this.token++ // detach pending callbacks
    speechSynthesis.cancel()
  }

  resume() {
    if (!this.items.length) return
    this.playing = true
    this.speak() // restart the current sentence; reliable across browsers
  }

  skipToPara(para) {
    const idx = this.items.findIndex((it) => !it.host && it.para >= para)
    this.i = idx === -1 ? this.items.length : idx
    if (this.playing) this.speak()
  }

  setRate(r) {
    this.rate = r
    if (this.playing) this.speak()
  }

  stop() {
    this.playing = false
    this.token++
    if (supported) speechSynthesis.cancel()
    this.items = []
  }
}
