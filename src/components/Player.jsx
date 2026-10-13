import { useState } from 'react'
import { Icon } from './Ornament.jsx'

const RATES = [0.8, 1, 1.15, 1.3, 1.5, 1.75, 2]
const SLEEP = [0, 10, 20, 30, 60]

export function Player({ book, ch, para, total, playing, prefs, voices, sleep, supported, onToggle, onPrevCh, onNextCh, onSkip, onSeek, onPrefs, onSleep }) {
  const [open, setOpen] = useState(false)
  const chapter = book.chapters[ch]
  const pct = total > 1 ? (para / (total - 1)) * 100 : 0
  const nextSleep = () => onSleep(SLEEP[(SLEEP.indexOf(sleep?.set ?? 0) + 1) % SLEEP.length])

  return (
    <footer className="player" role="region" aria-label="Player">
      {!supported && <p className="unsupported">Your browser can’t read aloud. Try Chrome, Edge or Safari.</p>}
      <div className="now">
        <div className="mini-cover" style={{ '--cover': book.cover, '--foil': book.foil }}><span /></div>
        <div className="meta">
          <strong>{chapter.title}</strong>
          <span>{book.title.replace(/;.*$/, '')}</span>
        </div>
      </div>

      <div className="transport">
        <div className="buttons">
          <button onClick={onPrevCh} aria-label="Previous episode" disabled={ch === 0}><Icon name="prev" /></button>
          <button onClick={() => onSkip(-3)} aria-label="Back a few paragraphs"><Icon name="back" /></button>
          <button className="play" onClick={onToggle} aria-label={playing ? 'Pause' : 'Play'} disabled={!supported}><Icon name={playing ? 'pause' : 'play'} /></button>
          <button onClick={() => onSkip(3)} aria-label="Forward a few paragraphs"><Icon name="fwd" /></button>
          <button onClick={onNextCh} aria-label="Next episode" disabled={ch >= book.chapters.length - 1}><Icon name="next" /></button>
        </div>
        <div className="scrub">
          <span>{para + 1}</span>
          <input
            type="range" min={0} max={Math.max(0, total - 1)} value={Math.min(para, Math.max(0, total - 1))}
            onChange={(e) => onSeek(+e.target.value)}
            style={{ '--pct': `${pct}%` }}
            aria-label="Position in this episode"
          />
          <span>{total}</span>
        </div>
      </div>

      <div className="options">
        <button className={`chip ${prefs.mode === 'condensed' ? 'on' : ''}`} onClick={() => onPrefs({ mode: prefs.mode === 'full' ? 'condensed' : 'full' })} title="Highlights plays the lead sentence of each paragraph">
          {prefs.mode === 'full' ? 'Full reading' : 'Highlights'}
        </button>
        <label className="chip">
          <span className="sr">Speed</span>
          <select value={prefs.rate} onChange={(e) => onPrefs({ rate: +e.target.value })}>
            {RATES.map((r) => <option key={r} value={r}>{r}×</option>)}
          </select>
        </label>
        <button className={`chip ${sleep ? 'on' : ''}`} onClick={nextSleep} title="Sleep timer">
          <Icon name="moon" /> {sleep ? `${sleep.left}m` : 'Sleep'}
        </button>
        <button className="chip" onClick={() => setOpen(!open)} aria-expanded={open}>Voices</button>
      </div>

      {open && (
        <div className="voice-panel">
          <label>Narrator
            <select value={prefs.voice} onChange={(e) => onPrefs({ voice: e.target.value })}>
              <option value="">Automatic</option>
              {voices.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
            </select>
          </label>
          <label>Host
            <select value={prefs.hostVoice} onChange={(e) => onPrefs({ hostVoice: e.target.value })}>
              <option value="">Automatic</option>
              {voices.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
            </select>
          </label>
        </div>
      )}
    </footer>
  )
}
