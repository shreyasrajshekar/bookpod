import { memo, useEffect, useRef, useState } from 'react'
import { Ornament } from './Ornament.jsx'
import { countWords, minutesFor } from '../lib/textBook.js'

const roman = (n) => {
  const m = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
  let s = ''
  for (const [v, r] of m) while (n >= v) { s += r; n -= v }
  return s
}

// Memoised so advancing the highlight re-renders only the paragraphs whose state changed.
const Para = memo(function Para({ text, index, state, innerRef, onPick }) {
  return (
    <p ref={innerRef} className={`${index === 0 ? 'dropcap' : ''} ${state}`} onClick={() => onPick(index)} title="Listen from here">
      {text}
    </p>
  )
})

export function Reader({ book, ch, para, paras, playing, rate, onPickChapter, onPickPara }) {
  const [tab, setTab] = useState('page')
  const active = useRef(null)
  const chapter = book.chapters[ch]
  const [kicker, ...restTitle] = chapter.title.split(/\s[—·]\s|:\s/)

  useEffect(() => {
    active.current?.scrollIntoView({ block: 'center', behavior: 'auto' })
  }, [para, ch])

  return (
    <div className={`spread tab-${tab}`}>
      <div className="mobile-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'contents'} onClick={() => setTab('contents')}>Contents</button>
        <button role="tab" aria-selected={tab === 'page'} onClick={() => setTab('page')}>The Page</button>
      </div>

      <section className="page left" aria-label="Contents">
        <div className="title-page">
          <p className="eyebrow">A BookPod Presentation</p>
          <h1>{book.title.replace(/;.*$/, '')}</h1>
          <Ornament />
          <p className="by">by {book.author}</p>
        </div>
        <h2 className="toc-head">Episodes</h2>
        <ol className="toc">
          {book.chapters.map((c, i) => {
            const mins = minutesFor(countWords(c.paragraphs.join(' ')), rate)
            return (
              <li key={i}>
                <button className={i === ch ? 'current' : ''} onClick={() => { onPickChapter(i); setTab('page') }} aria-current={i === ch}>
                  <span className="num">{roman(i + 1)}</span>
                  <span className="name">{c.title}</span>
                  <span className="dots" />
                  <span className="min">{i === ch && playing ? <span className="eq" aria-label="playing"><i /><i /><i /></span> : `${mins}m`}</span>
                </button>
              </li>
            )
          })}
        </ol>
      </section>

      <div className="gutter" aria-hidden="true" />

      <section className="page right" aria-label="Chapter text">
        <i className="bookmark-ribbon" aria-hidden="true" />
        <div className="turn" key={`${book.id}-${ch}`}>
          <header className="chapter-head">
            <p className="eyebrow">Episode {ch + 1} of {book.chapters.length}</p>
            <h2>{kicker}</h2>
            {restTitle.length > 0 && <p className="subtitle">{restTitle.join(' — ')}</p>}
            <Ornament />
          </header>
          <div className="prose">
            {paras.map((p, i) => (
              <Para key={i} text={p} index={i} state={i === para ? 'reading' : i < para ? 'read' : ''} innerRef={i === para ? active : null} onPick={onPickPara} />
            ))}
          </div>
          <footer className="page-foot">
            <Ornament />
            <p>{ch + 1 < book.chapters.length ? 'The story continues…' : 'The End'}</p>
          </footer>
        </div>
      </section>
    </div>
  )
}
