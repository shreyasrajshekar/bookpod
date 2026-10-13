import JSZip from 'jszip'
import { parseTextBook, normalizeChapters, countWords, buildChapters } from './textBook.js'

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
const palette = [
  ['#7a2e2e', '#c9a14a'], ['#1f3a4d', '#d9b86c'], ['#2f4a3a', '#e3c98b'],
  ['#4a2c4f', '#e0b97a'], ['#5b3a1e', '#e8d29a'], ['#23324f', '#e6c27a'],
]
const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)

function finish(parsed, source) {
  const id = uid()
  const [cover, foil] = palette[hash(parsed.title) % palette.length]
  const chapters = parsed.chapters.map((c, i) => ({ ...c, id: i }))
  if (!chapters.length) throw new Error('No readable text was found in this file.')
  const totalWords = chapters.reduce((n, c) => n + countWords(c.paragraphs.join(' ')), 0)
  return { id, title: parsed.title, author: parsed.author, chapters, totalWords, cover, foil, source, addedAt: Date.now() }
}

async function parseEpub(buf, filename) {
  const zip = await JSZip.loadAsync(buf)
  const read = (p) => zip.file(decodeURIComponent(p))?.async('string')
  const dom = (s, type = 'application/xml') => new DOMParser().parseFromString(s, type)

  const container = dom(await read('META-INF/container.xml'))
  const opfPath = container.querySelector('rootfile').getAttribute('full-path')
  const opf = dom(await read(opfPath))
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''

  const first = (sel) => opf.getElementsByTagName(sel)[0]?.textContent?.trim()
  const title = first('dc:title') || filename.replace(/\.[^.]+$/, '')
  const author = first('dc:creator') || 'Unknown author'

  const manifest = {}
  for (const it of opf.getElementsByTagName('item')) manifest[it.getAttribute('id')] = it.getAttribute('href')
  const spine = [...opf.getElementsByTagName('itemref')].map((r) => manifest[r.getAttribute('idref')]).filter(Boolean)

  const chapters = []
  for (const href of spine) {
    const html = await read(base + href.split('#')[0])
    if (!html) continue
    const doc = dom(html, 'text/html')
    doc.querySelectorAll('script,style,nav,sup.noteref,.pagebreak').forEach((n) => n.remove())
    const heading = doc.querySelector('h1,h2,h3')?.textContent?.replace(/\s+/g, ' ').trim()
    const nodes = [...doc.querySelectorAll('p, blockquote, li')].filter((n) => !n.querySelector('p'))
    const paragraphs = nodes.map((n) => n.textContent.replace(/\s+/g, ' ').trim()).filter((t) => t.length > 1)
    if (!paragraphs.length) continue
    chapters.push({ title: heading || `Section ${chapters.length + 1}`, paragraphs })
  }
  // Gutenberg-style licences and contents pages are short or boilerplate.
  const body = chapters.filter((c) => !/project gutenberg|full license/i.test(c.paragraphs.slice(0, 3).join(' ')))
  return { title, author, chapters: normalizeChapters(body.length ? body : chapters) }
}

async function parsePdf(buf, filename) {
  const pdfjs = await import('pdfjs-dist/build/pdf.mjs')
  const worker = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  const pdf = await pdfjs.getDocument({ data: buf }).promise
  const meta = await pdf.getMetadata().catch(() => null)
  const paras = []
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent()
    let line = '', lastY = null, lastH = 10, para = ''
    const flushLine = () => { if (line.trim()) para += (para && !para.endsWith('-') ? ' ' : '') + line.trim().replace(/-$/, ''); line = '' }
    for (const it of content.items) {
      if (!('str' in it)) continue
      const y = it.transform[5], h = it.height || lastH
      if (lastY !== null && Math.abs(y - lastY) > h * 0.5) {
        flushLine()
        if (lastY - y > h * 1.9 && para) { paras.push(para); para = '' }
      }
      line += it.str
      lastY = y; lastH = h
    }
    flushLine()
    if (para) paras.push(para)
  }
  const text = paras.join('\n\n')
  const { chapters } = buildChapters(text)
  const t = meta?.info?.Title?.trim()
  return { title: t || filename.replace(/\.[^.]+$/, ''), author: meta?.info?.Author?.trim() || 'Unknown author', chapters }
}

export async function loadBookFile(file) {
  const name = file.name
  const ext = name.split('.').pop().toLowerCase()
  let parsed
  if (ext === 'epub') parsed = await parseEpub(await file.arrayBuffer(), name)
  else if (ext === 'pdf') parsed = await parsePdf(await file.arrayBuffer(), name)
  else if (['txt', 'md', 'text', 'html', 'htm'].includes(ext) || file.type.startsWith('text/')) {
    let raw = await file.text()
    if (ext === 'html' || ext === 'htm') raw = new DOMParser().parseFromString(raw, 'text/html').body.innerText
    parsed = parseTextBook(raw, name)
  } else throw new Error(`“.${ext}” isn’t supported yet. Try EPUB, PDF or TXT.`)
  if (!parsed.chapters.length) throw new Error('No readable text was found in this file.')
  return finish(parsed, name)
}

export const SAMPLES = [
  { file: 'alice.txt', label: 'Alice’s Adventures in Wonderland' },
  { file: 'yellow-wallpaper.txt', label: 'The Yellow Wallpaper' },
  { file: 'metamorphosis.epub', label: 'Metamorphosis' },
  { file: 'christmas-carol.txt', label: 'A Christmas Carol' },
]

export async function loadSample(file) {
  const res = await fetch(`/samples/${file}`)
  if (!res.ok) throw new Error('Could not fetch sample book')
  const blob = await res.blob()
  return loadBookFile(new File([blob], file, { type: blob.type }))
}
