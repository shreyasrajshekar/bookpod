import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Library } from './components/Library.jsx'
import { Reader } from './components/Reader.jsx'
import { Player } from './components/Player.jsx'
import { Icon } from './components/Ornament.jsx'
import { condense, countWords, minutesFor } from './lib/textBook.js'
import { loadBookFile, loadSample, SAMPLES } from './lib/loadBook.js'
import { deleteBook, getPrefs, getProgress, listBooks, markSeeded, saveBook, setPrefs as savePrefs, setProgress, wasSeeded } from './lib/store.js'
import { Engine, hostIntro, hostOutro } from './lib/speech.js'
import { loadVoices, voicesReady, supported, synth } from './lib/studio.js'

// Gutenberg marks italics with _underscores_; drop the markers so they're neither shown nor spoken.
const plain = (ps) => ps.map((p) => p.replace(/_([^_]+)_/g, '$1'))
const displayParas = (book, ch, mode) => plain(mode === 'condensed' ? condense(book.chapters[ch].paragraphs) : book.chapters[ch].paragraphs)

export default function App() {
  const [books, setBooks] = useState([])
  const [progress, setProg] = useState({})
  const [bookId, setBookId] = useState(null)
  const [ch, setCh] = useState(0)
  const [para, setPara] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [prefs, setPrefsState] = useState(getPrefs)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [sleep, setSleep] = useState(null)
  const [studio, setStudio] = useState({ status: 'idle', progress: 0 })
  const [buffering, setBuffering] = useState(false)
  const [notice, setNotice] = useState('')
  const previewAudio = useRef(null)

  const book = useMemo(() => books.find((b) => b.id === bookId) || null, [books, bookId])
  const paras = useMemo(() => (book ? displayParas(book, ch, prefs.mode) : []), [book, ch, prefs.mode])

  // Latest state for engine callbacks, which outlive renders.
  const live = useRef({})
  live.current = { ...live.current, book, ch, para, prefs, paras }
  const loadedKey = useRef('')
  const engine = useRef(null)
  const sleepTimer = useRef(null)
  const startToken = useRef(0)

  /** Download the voice model once; safe to call repeatedly. */
  const ensureVoices = useCallback((narrator, host) => {
    const { studioVoice, studioHost } = live.current.prefs
    narrator = narrator || studioVoice
    host = host || studioHost
    if (voicesReady(narrator)) { loadVoices(narrator, host).catch(() => {}); return Promise.resolve() }
    setStudio((s) => (s.status === 'loading' ? s : { status: 'loading', progress: 0, error: '' }))
    return loadVoices(narrator, host, (progress) => setStudio({ status: 'loading', progress, error: '' }))
      .then(() => setStudio({ status: 'ready', progress: 1, error: '' }))
      .catch((e) => {
        console.error(e)
        setStudio({ status: 'error', progress: 0, error: e.message || String(e) })
        throw e
      })
  }, [])

  const startEpisode = useCallback(async (chIdx, startPara = 0) => {
    const { book: b, prefs: p } = live.current
    if (!b) return
    const my = ++startToken.current
    setPlaying(true)
    if (!voicesReady(p.studioVoice)) {
      try { await ensureVoices(p.studioVoice, p.studioHost) } catch (err) {
        setPlaying(false)
        setNotice('The voices couldn’t load: ' + (err.message || 'unknown error') + ' Check your connection and press Retry.')
        return
      }
      if (my !== startToken.current) return // user paused or moved on while it downloaded
    }
    const list = displayParas(b, chIdx, p.mode)
    const chapter = b.chapters[chIdx]
    const mins = minutesFor(countWords(list.join(' ')), p.rate)
    const e = engine.current
    e.narrator = p.studioVoice
    e.host = p.studioHost
    e.hostReady = () => voicesReady(live.current.prefs.studioHost)
    e.rate = p.rate
    e.load({ intro: hostIntro(b, chapter, mins), paragraphs: list, outro: hostOutro(chapter, b.chapters[chIdx + 1]), startPara })
    loadedKey.current = `${b.id}:${chIdx}:${p.mode}`
    e.start()
  }, [ensureVoices])

  useEffect(() => {
    engine.current = new Engine({
      onItem: (item) => {
        const total = live.current.paras.length
        if (item.para >= 0) setPara(Math.min(item.para, total - 1))
      },
      onEnd: () => live.current.advance(),
      onBuffering: setBuffering,
      onError: (err) => {
        console.error(err)
        engine.current.pause()
        setPlaying(false)
        setNotice('Something went wrong generating the voice: ' + (err?.message || 'unknown error'))
      },
    })
    return () => engine.current.stop()
  }, [])

  // When an episode finishes, roll straight into the next one.
  live.current.advance = () => {
    const { book: b, ch: c } = live.current
    if (b && c + 1 < b.chapters.length) {
      setCh(c + 1)
      setPara(0)
      live.current.ch = c + 1
      startEpisode(c + 1, 0)
    } else {
      setPlaying(false)
      loadedKey.current = ''
    }
  }

  // Load the library; the first visit gets a shelf of public-domain classics.
  useEffect(() => {
    let alive = true
    ;(async () => {
      let all = await listBooks().catch(() => [])
      if (!all.length && !wasSeeded()) {
        setBusy('Stocking the shelf with a few classics…')
        for (const s of SAMPLES) {
          try { await saveBook(await loadSample(s.file)) } catch (e) { console.warn('sample failed', s.file, e) }
        }
        markSeeded()
        all = await listBooks()
        setBusy('')
      }
      if (!alive) return
      setBooks(all)
      setProg(Object.fromEntries(all.map((b) => [b.id, getProgress(b.id)])))
    })()
    return () => { alive = false }
  }, [])

  // Start fetching the voices as soon as a book is opened, so Play is instant by the time it's pressed.
  useEffect(() => {
    if (bookId && supported) ensureVoices().catch(() => {})
  }, [bookId, ensureVoices, prefs.studioVoice, prefs.studioHost])

  useEffect(() => {
    if (book) setProgress(book.id, { ch, p: para })
  }, [book, ch, para])

  const updatePrefs = (patch) => {
    const next = { ...prefs, ...patch }
    setPrefsState(next)
    savePrefs(next)
    if (patch.rate) engine.current.setRate(patch.rate)
    if (playing && (patch.mode || patch.studioVoice || patch.studioHost)) {
      // Rebuild the queue with the new mode/voice, keeping roughly the same place.
      setTimeout(() => {
        const { book: b, ch: c, para: p, paras: old } = live.current
        const ratio = old.length ? p / old.length : 0
        const len = displayParas(b, c, live.current.prefs.mode).length
        startEpisode(c, patch.mode ? Math.floor(ratio * len) : p)
      }, 0)
    } else if (patch.mode) {
      loadedKey.current = ''
      const len = book ? displayParas(book, ch, patch.mode).length : 0
      setPara((p) => Math.min(p, Math.max(0, len - 1)))
    }
  }

  const openBook = (id) => {
    const b = books.find((x) => x.id === id)
    const pr = getProgress(id)
    setBookId(id)
    setCh(Math.min(pr.ch, b.chapters.length - 1))
    setPara(pr.p)
    setPlaying(false)
    loadedKey.current = ''
    window.scrollTo({ top: 0 })
  }

  const closeBook = () => {
    startToken.current++
    engine.current.stop()
    setPlaying(false)
    setBuffering(false)
    if (book) setProg((m) => ({ ...m, [book.id]: { ch, p: para } }))
    setBookId(null)
    loadedKey.current = ''
  }

  const toggle = () => {
    const e = engine.current
    if (playing) {
      startToken.current++ // cancels a start that is still waiting on the voice download
      e.pause()
      setPlaying(false)
      setBuffering(false)
    } else if (loadedKey.current === `${book.id}:${ch}:${prefs.mode}` && e.items.length) {
      e.resume()
      setPlaying(true)
    } else startEpisode(ch, para)
  }

  const goTo = (p, autoplay = false) => {
    const np = Math.max(0, Math.min(paras.length - 1, p))
    setPara(np)
    if (playing || autoplay) {
      if (loadedKey.current === `${book.id}:${ch}:${prefs.mode}` && engine.current.items.length) {
        engine.current.skipToPara(np)
        if (!playing) { engine.current.resume(); setPlaying(true) }
      } else startEpisode(ch, np)
    }
  }
  live.current.goTo = goTo
  const pickPara = useCallback((i) => live.current.goTo(i, true), [])

  const pickChapter = (i) => {
    startToken.current++
    setCh(i)
    setPara(0)
    live.current.ch = i
    loadedKey.current = ''
    if (playing) startEpisode(i, 0)
  }

  const step = (dir) => {
    const i = ch + dir
    if (i >= 0 && i < book.chapters.length) pickChapter(i)
  }

  const preview = async (voice) => {
    engine.current.pause()
    startToken.current++
    setPlaying(false)
    previewAudio.current?.pause()
    try {
      await ensureVoices(voice, prefs.studioHost)
      previewAudio.current = new Audio(await synth('It was the best of times, it was the worst of times.', voice))
      previewAudio.current.play()
    } catch (err) {
      setNotice('The voice couldn’t load: ' + (err.message || 'unknown error') + ' Check your connection and try again.')
    }
  }

  const setSleepTimer = (mins) => {
    clearInterval(sleepTimer.current)
    if (!mins) return setSleep(null)
    let left = mins
    setSleep({ set: mins, left })
    sleepTimer.current = setInterval(() => {
      left -= 1
      if (left <= 0) {
        clearInterval(sleepTimer.current)
        engine.current.pause()
        setPlaying(false)
        setSleep(null)
      } else setSleep({ set: mins, left })
    }, 60000)
  }

  const addFiles = async (files) => {
    setError('')
    for (const f of files) {
      setBusy(`Binding “${f.name}”…`)
      try {
        const b = await loadBookFile(f)
        await saveBook(b)
        setBooks((all) => [...all, b])
        setProg((m) => ({ ...m, [b.id]: { ch: 0, p: 0 } }))
      } catch (e) {
        console.error(e)
        setError(`${f.name}: ${e.message || 'could not be read.'}`)
      }
    }
    setBusy('')
  }

  const removeBook = async (b) => {
    if (!window.confirm(`Remove “${b.title}” from your library?`)) return
    await deleteBook(b.id)
    setBooks((all) => all.filter((x) => x.id !== b.id))
  }

  // Keyboard: space plays/pauses, arrows hop paragraphs.
  useEffect(() => {
    const onKey = (e) => {
      if (!book || /INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName)) return
      if (e.code === 'Space') { e.preventDefault(); toggle() }
      if (e.code === 'ArrowRight') goTo(para + 1)
      if (e.code === 'ArrowLeft') goTo(para - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className={`app ${book ? 'reading' : ''}`}>
      <header className="topbar">
        <button className="brand" onClick={closeBook} aria-label="BookPod home">
          <span className="logo"><Icon name="book" /></span>
          <span>BookPod</span>
        </button>
        {book && <button className="btn ghost" onClick={closeBook}>← Library</button>}
      </header>

      {!book ? (
        <Library books={books} progress={progress} busy={busy} error={error} onAddFiles={addFiles} onOpen={openBook} onDelete={removeBook} />
      ) : (
        <>
          <Reader book={book} ch={ch} para={para} paras={paras} playing={playing} rate={prefs.rate} onPickChapter={pickChapter} onPickPara={pickPara} />
          <Player
            book={book} ch={ch} para={para} total={paras.length} playing={playing} prefs={prefs}
            sleep={sleep} supported={supported} studio={studio} buffering={buffering} notice={notice}
            onDismiss={() => setNotice('')} onRetry={() => { setNotice(''); ensureVoices().catch(() => {}) }} onPreview={preview}
            onToggle={toggle} onPrevCh={() => step(-1)} onNextCh={() => step(1)}
            onSkip={(n) => goTo(para + n)} onSeek={(v) => goTo(v)} onPrefs={updatePrefs} onSleep={setSleepTimer}
          />
        </>
      )}
      <p className="colophon">Public-domain samples courtesy of Project Gutenberg.</p>
    </div>
  )
}
