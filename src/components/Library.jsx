import { useRef, useState } from 'react'
import { Icon, Ornament } from './Ornament.jsx'
import { minutesFor } from '../lib/textBook.js'

const fmt = (mins) => (mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`)

export function Library({ books, progress, busy, error, onAddFiles, onOpen, onDelete }) {
  const input = useRef(null)
  const [over, setOver] = useState(false)

  const drop = (e) => {
    e.preventDefault()
    setOver(false)
    if (e.dataTransfer.files?.length) onAddFiles([...e.dataTransfer.files])
  }

  return (
    <main className="library">
      <section className="hero">
        <p className="eyebrow">A private reading room for your ears</p>
        <h1>Turn any book into a podcast.</h1>
        <Ornament />
        <p className="lede">
          Drop in an EPUB, PDF or text file. BookPod binds it into chapters, one episode each, and a pair of voices reads it
          to you, hosted like a show. Everything happens in your browser, so your books never leave your device.
        </p>
      </section>

      <section
        className={`dropzone ${over ? 'over' : ''} ${busy ? 'busy' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        <input
          ref={input}
          type="file"
          hidden
          multiple
          accept=".epub,.pdf,.txt,.md,.html,.htm,application/epub+zip,application/pdf,text/*"
          data-testid="file-input"
          onChange={(e) => { onAddFiles([...e.target.files]); e.target.value = '' }}
        />
        <div className="dz-mark"><Icon name="plus" /></div>
        <div className="dz-text">
          <h2>{busy ? busy : over ? 'Let go to bind this book' : 'Add a book to the shelf'}</h2>
          <p>{busy ? 'Reading the pages, finding the chapters…' : 'Drag a file here, or choose one. EPUB · PDF · TXT'}</p>
        </div>
        <button className="btn brass" disabled={!!busy} onClick={() => input.current.click()}>Choose a file</button>
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      <section aria-label="Your library">
        <h2 className="shelf-title"><span>Your Library</span></h2>
        {books.length === 0 && <p className="empty">The shelf is empty. Add your first book above.</p>}
        <ul className="shelf">
          {books.map((b, i) => {
            const pr = progress[b.id] || { ch: 0, p: 0 }
            const started = pr.ch > 0 || pr.p > 0
            return (
              <li key={b.id} style={{ '--i': i }}>
                <button className="book" onClick={() => onOpen(b.id)} style={{ '--cover': b.cover, '--foil': b.foil }} aria-label={`Open ${b.title}`}>
                  <span className="book-spine" />
                  <span className="book-face">
                    <span className="foil-frame">
                      <small>{b.author}</small>
                      <strong>{b.title.replace(/;.*$/, '')}</strong>
                      <Ornament />
                      <em>{b.chapters.length} episodes · {fmt(minutesFor(b.totalWords))}</em>
                    </span>
                    {started && <span className="ribbon-tag">Ep {pr.ch + 1}</span>}
                  </span>
                  <span className="book-pages" />
                </button>
                <button className="del" onClick={() => onDelete(b)} aria-label={`Remove ${b.title}`} title="Remove from library"><Icon name="trash" /></button>
              </li>
            )
          })}
        </ul>
      </section>
    </main>
  )
}
