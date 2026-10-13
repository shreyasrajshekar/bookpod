import { useState } from 'react'
import { Icon } from './Ornament.jsx'
import { STUDIO_VOICES } from '../lib/studio.js'
import { voiceTier } from '../lib/speech.js'

const RATES = [0.8, 1, 1.15, 1.3, 1.5, 1.75, 2]
const SLEEP = [0, 10, 20, 30, 60]

export function Player({ book, ch, para, total, playing, prefs, voices, sleep, supported, studio, buffering, notice, onDismiss, onEnableStudio, onPreview, onToggle, onPrevCh, onNextCh, onSkip, onSeek, onPrefs, onSleep }) {
  const [open, setOpen] = useState(false)
  const chapter = book.chapters[ch]
  const pct = total > 1 ? (para / (total - 1)) * 100 : 0
  const nextSleep = () => onSleep(SLEEP[(SLEEP.indexOf(sleep?.set ?? 0) + 1) % SLEEP.length])

  return (
    <footer className="player" role="region" aria-label="Player">
      {notice && <p className="notice" role="status">{notice} <button onClick={onDismiss} aria-label="Dismiss">×</button></p>}
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
          <button className={`play ${buffering || studio.status === 'loading' ? 'wait' : ''}`} onClick={onToggle} aria-label={playing ? 'Pause' : 'Play'} disabled={!supported}><Icon name={playing ? 'pause' : 'play'} /></button>
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
          <div className="seg" role="tablist" aria-label="Voice engine">
            <button role="tab" aria-selected={prefs.engine === 'device'} onClick={() => onPrefs({ engine: 'device' })}>Device voices</button>
            <button role="tab" aria-selected={prefs.engine === 'studio'} onClick={() => (studio.status === 'ready' ? onPrefs({ engine: 'studio' }) : onEnableStudio())} disabled={studio.status === 'loading'}>
              Studio voices <small>AI</small>
            </button>
          </div>

          {studio.status === 'loading' && (
            <p className="hint">Downloading the studio voice model (about 90 MB, once)… {Math.round(studio.progress * 100)}%
              <span className="bar"><i style={{ width: `${studio.progress * 100}%` }} /></span></p>
          )}

          {prefs.engine === 'device' ? (
            <>
              <p className="hint">These come from your browser or operating system. Voices marked Natural sound best — on Edge, look for “Online (Natural)”.</p>
              <div className="pickers">
                <label>Narrator
                  <span className="pick">
                    <select value={prefs.voice} onChange={(e) => onPrefs({ voice: e.target.value })}>
                      <option value="">Automatic (best available)</option>
                      {voices.map((v) => <option key={v.name} value={v.name}>{v.name} · {voiceTier(v)}</option>)}
                    </select>
                    <button onClick={() => onPreview('device', prefs.voice)} aria-label="Preview narrator voice"><Icon name="play" /></button>
                  </span>
                </label>
                <label>Host
                  <span className="pick">
                    <select value={prefs.hostVoice} onChange={(e) => onPrefs({ hostVoice: e.target.value })}>
                      <option value="">Automatic</option>
                      {voices.map((v) => <option key={v.name} value={v.name}>{v.name} · {voiceTier(v)}</option>)}
                    </select>
                    <button onClick={() => onPreview('device', prefs.hostVoice)} aria-label="Preview host voice"><Icon name="play" /></button>
                  </span>
                </label>
              </div>
            </>
          ) : (
            <>
              <p className="hint">Neural voices generated on your device. Slightly slower to start, much more lifelike.</p>
              <div className="pickers">
                <label>Narrator
                  <span className="pick">
                    <select value={prefs.studioVoice} onChange={(e) => onPrefs({ studioVoice: e.target.value })}>
                      {STUDIO_VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                    </select>
                    <button onClick={() => onPreview('studio', prefs.studioVoice)} aria-label="Preview narrator voice"><Icon name="play" /></button>
                  </span>
                </label>
                <label>Host
                  <span className="pick">
                    <select value={prefs.studioHost} onChange={(e) => onPrefs({ studioHost: e.target.value })}>
                      {STUDIO_VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                    </select>
                    <button onClick={() => onPreview('studio', prefs.studioHost)} aria-label="Preview host voice"><Icon name="play" /></button>
                  </span>
                </label>
              </div>
            </>
          )}
        </div>
      )}
    </footer>
  )
}
