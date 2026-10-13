// Pure text → book structure. No DOM, so it runs in the browser and in node tests.

const HEADING =
  /^\s*(chapter|book|part|stave|section|letter|canto|act|scene)\s+([0-9]+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|first|second|third|fourth|fifth)\b[\s.:\-—]*(.*)$/i

const TARGET_WORDS = 1800

export const countWords = (s) => (s.match(/\S+/g) || []).length

function stripGutenberg(raw) {
  let text = raw.replace(/\r\n?/g, '\n').replace(/^﻿/, '')
  const start = text.match(/\*\*\* ?START OF (THE|THIS) PROJECT GUTENBERG[^\n]*\n/i)
  const end = text.search(/\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG/i)
  let meta = text
  if (start) text = text.slice(start.index + start[0].length)
  if (end >= 0 && start) {
    const e = text.search(/\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG/i)
    if (e >= 0) text = text.slice(0, e)
  }
  return { text, meta }
}

function sniffMeta(meta, filename) {
  const title = meta.match(/^Title:\s*(.+)$/im)?.[1]?.trim()
  const author = meta.match(/^Author:\s*(.+)$/im)?.[1]?.trim()
  const fallback = (filename || 'Untitled').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
  return { title: title || fallback, author: author || 'Unknown author' }
}

function toParagraphs(text) {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
}

function groupIntoParts(paragraphs, label = 'Part', target = TARGET_WORDS) {
  const parts = []
  let cur = []
  let words = 0
  for (const p of paragraphs) {
    cur.push(p)
    words += countWords(p)
    if (words >= target) {
      parts.push(cur)
      cur = []
      words = 0
    }
  }
  if (cur.length) {
    if (parts.length && words < target * 0.35) parts[parts.length - 1].push(...cur)
    else parts.push(cur)
  }
  return parts.map((paragraphs, i) => ({ title: `${label} ${i + 1}`, paragraphs }))
}

/** Split a block of plain text into chapters by heading detection. */
export function chaptersFromText(text) {
  // Walk blocks (blank-line separated) so we can look at heading + subtitle structure.
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
  const chapters = []
  let current = null

  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i].split('\n').map((l) => l.trim()).filter(Boolean)
    const first = lines[0]
    const m = first.length < 90 && first.match(HEADING)
    const looksLikeHeading = m && lines.length <= 3 && blocks[i].length < 140
    if (looksLikeHeading) {
      let title = first.replace(/[.:]+$/, '')
      const rest = lines.slice(1).join(' ')
      if (rest) title += ` — ${rest.replace(/[.:]+$/, '')}`
      else {
        // subtitle may be the next short block, e.g. "CHAPTER I.\n\nDown the Rabbit-Hole"
        const next = blocks[i + 1]
        if (next && next.length < 70 && !/[.!?"”]$/.test(next) && !next.includes('\n')) {
          title += ` — ${next}`
          i++
        }
      }
      current = { title: tidyTitle(title), paragraphs: [] }
      chapters.push(current)
    } else if (current) {
      current.paragraphs.push(...toParagraphs(blocks[i]))
    } else {
      // Front matter before the first chapter heading.
      current = { title: 'Opening', paragraphs: toParagraphs(blocks[i]) }
      chapters.push(current)
    }
  }
  return chapters
}

const SMALL = new Set(['of', 'the', 'and', 'a', 'an', 'in', 'on', 'to', 'for'])
function tidyTitle(t) {
  // "THE END OF IT" -> "The End of It"; roman numerals stay upper-case.
  return t
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w, i) => {
      if (/^[IVXLCDM]+[.:]?$/.test(w) || w !== w.toUpperCase() || w.length < 2) return w
      const lower = w.toLowerCase()
      return SMALL.has(lower) && i > 1 ? lower : lower[0].toUpperCase() + lower.slice(1)
    })
    .join(' ')
}

/** Build chapters, dropping table-of-contents stubs and falling back to even parts. */
export function buildChapters(text) {
  let chapters = chaptersFromText(text)
  chapters = chapters.filter((c) => countWords(c.paragraphs.join(' ')) >= 80)
  // Title page / contents debris before the first real chapter.
  if (chapters.length > 2 && chapters[0].title === 'Opening' && countWords(chapters[0].paragraphs.join(' ')) < 400) chapters.shift()
  const totalWords = countWords(text)

  const usable = chapters.length >= 2 && chapters.every((c) => countWords(c.paragraphs.join(' ')) < 14000)
  if (!usable) {
    chapters = groupIntoParts(toParagraphs(text), 'Part')
  } else {
    // Break up monster chapters into parts; fold stub "Opening" into the next chapter title.
    chapters = chapters.flatMap((c) => {
      const w = countWords(c.paragraphs.join(' '))
      if (w <= 6000) return [c]
      return groupIntoParts(c.paragraphs, 'Part', 3000).map((p, i) => ({ ...p, title: `${c.title} · Part ${i + 1}` }))
    })
  }
  if (!chapters.length) chapters = [{ title: 'The Text', paragraphs: toParagraphs(text) }]
  return { chapters, totalWords }
}

export function parseTextBook(raw, filename = '') {
  const { text, meta } = stripGutenberg(raw)
  const { title, author } = sniffMeta(meta.slice(0, 4000), filename)
  const { chapters, totalWords } = buildChapters(text)
  // Drop a repeated title / byline at the very top of the first chapter.
  const ps = chapters[0]?.paragraphs
  const norm = (x) => x.toLowerCase().replace(/[^a-z]/g, '')
  while (ps && ps.length > 3 && ps[0].length < 90 && (norm(ps[0]) === norm(title) || /^by\s/i.test(ps[0]) || norm(ps[0]) === norm(author))) ps.shift()
  return { title, author, chapters, totalWords }
}

/** Condensed mode: the lead sentence of every paragraph, long ones get two. */
export function condense(paragraphs) {
  const out = []
  for (const p of paragraphs) {
    const sentences = p.match(/[^.!?]+[.!?]+["”')\]]*\s*|[^.!?]+$/g) || [p]
    if (countWords(p) < 18) {
      out.push(p)
      continue
    }
    const take = countWords(p) > 120 ? 2 : 1
    out.push(sentences.slice(0, take).join(' ').trim())
  }
  return out
}

/** Split a paragraph into speakable chunks (browsers choke on very long utterances). */
export function speechChunks(paragraph, max = 220) {
  const sentences = paragraph.match(/[^.!?]+[.!?]+["”')\]]*\s*|[^.!?]+$/g) || [paragraph]
  const chunks = []
  let cur = ''
  for (const s of sentences) {
    if ((cur + s).length > max && cur) {
      chunks.push(cur.trim())
      cur = ''
    }
    cur += s
    while (cur.length > max * 1.6) {
      const cut = cur.lastIndexOf(',', max) > 40 ? cur.lastIndexOf(',', max) + 1 : cur.lastIndexOf(' ', max)
      chunks.push(cur.slice(0, cut).trim())
      cur = cur.slice(cut)
    }
  }
  if (cur.trim()) chunks.push(cur.trim())
  return chunks
}

export const minutesFor = (words, rate = 1) => Math.max(1, Math.round(words / (155 * rate)))

/** For pre-structured sources (EPUB spine items): drop stubs, split very long chapters. */
export function normalizeChapters(chapters) {
  const kept = chapters.filter((c) => countWords(c.paragraphs.join(' ')) >= 120)
  return kept.flatMap((c) => {
    const w = countWords(c.paragraphs.join(' '))
    if (w <= 6000) return [c]
    return groupIntoParts(c.paragraphs, 'Part', 3000).map((p, i) => ({ ...p, title: `${c.title} · Part ${i + 1}` }))
  })
}

export { toParagraphs }
