import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Library } from './components/Library.jsx'
import { Reader } from './components/Reader.jsx'
import { Player } from './components/Player.jsx'
import { Icon } from './components/Ornament.jsx'
import { condense, countWords, minutesFor } from './lib/textBook.js'
import { loadBookFile, loadSample, SAMPLES } from './lib/loadBook.js'
import { deleteBook, getPrefs, getProgress, listBooks, markSeeded, saveBook, setPrefs as savePrefs, setProgress, wasSeeded } from './lib/store.js'
import { Engine, englishVoices, getVoices, hostIntro, hostOutro, previewDevice, supported } from './lib/speech.js'
import { loadStudio, studioReady, synth } from './lib/studio.js'
import { cloudReady, getCloudConfig, listCloudVoices, serverStatus, setCloudConfig, synthCloud } from './lib/cloud.js'

const displayParas = (book, ch, mode) => (mode === 'condensed' ? condense(book.chapters[ch].paragraphs) : book.chapters[ch].paragraphs)

export default function App() {
  const [books, setBooks] = useState([])
  const [progress, setProg] = useState({})
  const [bookId, setBookId] = useState(null)
  const [ch, setCh] = useState(0)
  const [para, setPara] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [prefs, setPrefsState] = useState(getPrefs)
  const [voices, setVoices] = useState([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [sleep, setSleep] = useState(null)
  const [studio, setStudio] = useState({ status: studioReady() ? 'ready' : 'idle', progress: 0 })
  const [buffering, setBuffering] = useState(false)
  const [notice, setNotice] = useState('')
  const previewAudio = useRef(null)
  const [cloud, setCloud] = useState(() => ({ cfg: getCloudConfig(), server: null, voices: [], status: 'idle', error: '' }))

  const book = useMemo(() => books.find((b) => b.id === bookId) || null, [books, bookId])
  const paras = useMemo(() => (book ? displayParas(book, ch, prefs.mode) : []), [book, ch, prefs.mode])

  // Latest state for engine callbacks, which outlive renders.
  const live = useRef({})
  live.current = { book, ch, para, prefs, paras }
  const loadedKey = useRef('')
  const engine = useRef(null)
  const sleepTimer = useRef(null)

  const resolved = useMemo(() => {
    const en = englishVoices(voices)
    const narrator = voices.find((v) => v.name === prefs.voice) || en[0] || voices[0] || null
    const host = voices.find((v) => v.name === prefs.hostVoice) || en.find((v) => v !== narrator) || narrator
    return { narrator, host }
  }, [voices, prefs.voice, prefs.hostVoice])

  const startEpisode = useCallback((chIdx, startPara = 0) => {
    const { book: b, prefs: p } = live.current
    if (!b) return
    if (p.engine === 'studio' && !studioReady()) {
      // First use: fetch the neural model, then begin.
      setStudio({ status: 'loading', progress: 0 })
      setPlaying(true)
      loadStudio((pr) => setStudio({ status: 'loading', progress: pr }))
        .then(() => { setStudio({ status: 'ready', progress: 1 }); startEpisode(chIdx, startPara) })
        .catch((err) => {
          console.error(err)
          setStudio({ status: 'error', progress: 0 })
          setNotice('Studio voices could not start on this device, so BookPod switched back to device voices.')
          setPlaying(false)
          const next = { ...live.current.prefs, engine: 'device' }
          setPrefsState(next)
          savePrefs(next)
        })
      return
    }
    const list = displayParas(b, chIdx, p.mode)
    const chapter = b.chapters[chIdx]
    const mins = minutesFor(countWords(list.join(' ')), p.rate)
    const next = b.chapters[chIdx + 1]
    const e = engine.current
    e.narrator = resolved.narrator
    e.host = resolved.host
    e.rate = p.rate
    e.backend = p.engine === 'device' ? 'device' : 'audio'
    e.synthesize = p.engine === 'cloud' ? synthCloud : synth
    e.audioNarrator = p.engine === 'cloud' ? p.cloudVoice : p.studioVoice
    e.audioHost = p.engine === 'cloud' ? p.cloudHost : p.studioHost
    e.load({ intro: hostIntro(b, chapter, mins), paragraphs: list, outro: hostOutro(chapter, next), startPara })
    loadedKey.current = `${b.id}:${chIdx}:${p.mode}`
    e.start()
    setPlaying(true)
  }, [resolved])

  // Engine is created once; callbacks read through `live`.
  useEffect(() => {
    engine.current = new Engine({
      onItem: (item) => {
        const total = live.current.paras.length
        if (item.para >= 0) setPara(Math.min(item.para, total - 1))
      },
      onEnd: () => live.current.advance(),
      onBuffering: (v) => setBuffering(v),
      onError: (err) => {
        console.error(err)
        engine.current.pause()
        setPlaying(false)
        setNotice('Studio voice failed: ' + (err?.message || 'unknown error') + '. Try device voices.')
      },
    })
    return () => engine.current.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  useEffect(() => {
    getVoices().then(setVoices)
  }, [])

  // Load the library; the first visit gets a shelf of public-domain classics.
  useEffect(() => {
    let alive = true
    ;(async () => {
      let all = await listBooks().catch(() => [])
      if (!all.length && !wasSeeded()) {
        setBusy('Stocking the shelf with a few classics…')
        for (const s of SAMPLES) {
          try {
            const b = await loadSample(s.file)
            await saveBook(b)
          } catch (e) {
            console.warn('sample failed', s.file, e)
          }
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

  useEffect(() => {
    if (!book) return
    setProgress(book.id, { ch, p: para })
    setProg((m) => ({ ...m, [book.id]: { ch, p: para } }))
  }, [book, ch, para])

  const updatePrefs = (patch) => {
    const next = { ...prefs, ...patch }
    setPrefsState(next)
    savePrefs(next)
    const e = engine.current
    if (patch.rate && e) e.setRate(patch.rate)
    if (playing && (patch.mode || patch.engine || patch.voice !== undefined || patch.hostVoice !== undefined || patch.studioVoice || patch.studioHost || patch.cloudVoice || patch.cloudHost)) {
      // Rebuild the queue with the new mode/voice, keeping roughly the same place.
      setTimeout(() => {
        const { book: b, ch: c, para: p } = live.current
        const ratio = live.current.paras.length ? p / live.current.paras.length : 0
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
    engine.current.stop()
    setPlaying(false)
    setBookId(null)
    loadedKey.current = ''
  }

  const toggle = () => {
    const e = engine.current
    if (playing) {
      e.pause()
      setPlaying(false)
    } else if (loadedKey.current === `${book.id}:${ch}:${prefs.mode}` && e.items.length) {
      e.narrator = resolved.narrator
      e.host = resolved.host
      e.resume()
      setPlaying(true)
    } else startEpisode(ch, para)
  }

  const goTo = (p, autoplay = false) => {
    const total = paras.length
    const np = Math.max(0, Math.min(total - 1, p))
    setPara(np)
    if (playing || autoplay) {
      if (loadedKey.current === `${book.id}:${ch}:${prefs.mode}` && engine.current.items.length) {
        engine.current.skipToPara(np)
        if (!playing) { engine.current.resume(); setPlaying(true) }
      } else startEpisode(ch, np)
    }
  }

  const pickChapter = (i) => {
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

  const preview = async (kind, value) => {
    engine.current.pause()
    setPlaying(false)
    previewAudio.current?.pause()
    if (kind === 'cloud') {
      try {
        previewAudio.current = new Audio(await synthCloud('It was the best of times, it was the worst of times.', value))
        previewAudio.current.play()
      } catch (e) { setNotice(e.message) }
      return
    }
    if (kind === 'device') return previewDevice(voices.find((v) => v.name === value) || resolved.narrator, prefs.rate)
    try {
      if (!studioReady()) {
        setStudio({ status: 'loading', progress: 0 })
        await loadStudio((pr) => setStudio({ status: 'loading', progress: pr }))
        setStudio({ status: 'ready', progress: 1 })
      }
      const url = await synth('It was the best of times, it was the worst of times.', value)
      previewAudio.current = new Audio(url)
      previewAudio.current.play()
    } catch (e) {
      console.error(e)
      setStudio({ status: 'error', progress: 0 })
      setNotice('Studio voices could not start on this device.')
    }
  }

  const enableStudio = async () => {
    setNotice('')
    try {
      setStudio({ status: 'loading', progress: 0 })
      await loadStudio((pr) => setStudio({ status: 'loading', progress: pr }))
      setStudio({ status: 'ready', progress: 1 })
      updatePrefs({ engine: 'studio' })
    } catch (e) {
      console.error(e)
      setStudio({ status: 'error', progress: 0 })
      setNotice('Studio voices could not start on this device.')
    }
  }

  // Premium (Google Cloud) voices: discover whether the site has a key, then list voices.
  useEffect(() => { serverStatus().then((server) => setCloud((c) => ({ ...c, server }))) }, [])

  const refreshCloud = async (cfgPatch = {}) => {
    const cfg = setCloudConfig(cfgPatch)
    setCloud((c) => ({ ...c, cfg, status: 'loading', error: '' }))
    try {
      const voices = await listCloudVoices(cfg)
      setCloud((c) => ({ ...c, cfg, voices, status: 'ready', error: '' }))
      return true
    } catch (e) {
      setCloud((c) => ({ ...c, cfg, voices: [], status: 'error', error: e.message }))
      return false
    }
  }

  const useCloud = async (cfgPatch) => {
    if (await refreshCloud(cfgPatch)) updatePrefs({ engine: 'cloud' })
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
          <Reader
            book={book} ch={ch} para={para} paras={paras} playing={playing} rate={prefs.rate}
            onPickChapter={pickChapter} onPickPara={(i) => goTo(i, true)}
          />
          <Player
            book={book} ch={ch} para={para} total={paras.length} playing={playing} prefs={prefs}
            voices={englishVoices(voices)} sleep={sleep} supported={supported || prefs.engine !== 'device'}
            cloud={cloud} onCloud={refreshCloud} onUseCloud={useCloud}
            studio={studio} buffering={buffering} notice={notice} onDismiss={() => setNotice('')}
            onEnableStudio={enableStudio} onPreview={preview}
            onToggle={toggle} onPrevCh={() => step(-1)} onNextCh={() => step(1)}
            onSkip={(n) => goTo(para + n)} onSeek={(v) => goTo(v)} onPrefs={updatePrefs} onSleep={setSleepTimer}
          />
        </>
      )}
      <p className="colophon">Public-domain samples courtesy of Project Gutenberg.</p>
    </div>
  )
}
