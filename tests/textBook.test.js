import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseTextBook, condense, speechChunks, countWords } from '../src/lib/textBook.js'

const load = (f) => readFileSync(new URL(`../public/samples/${f}`, import.meta.url), 'utf8')

test('Alice: metadata and 12 chapters', () => {
  const b = parseTextBook(load('alice.txt'), 'alice.txt')
  assert.match(b.title, /Alice/)
  assert.match(b.author, /Carroll/)
  assert.equal(b.chapters.length, 12)
  assert.match(b.chapters[0].title, /Chapter I/)
  assert.ok(b.chapters.every((c) => countWords(c.paragraphs.join(' ')) > 500))
})

test('A Christmas Carol: staves', () => {
  const b = parseTextBook(load('christmas-carol.txt'), 'x.txt')
  assert.ok(b.chapters.length >= 5)
  assert.match(b.chapters.at(-1).title, /Stave V/)
})

test('Yellow Wallpaper: no chapters falls back to parts', () => {
  const b = parseTextBook(load('yellow-wallpaper.txt'), 'x.txt')
  assert.ok(b.chapters.length >= 2)
  assert.match(b.chapters[0].title, /Part 1/)
})

test('no Gutenberg boilerplate leaks into text', () => {
  const b = parseTextBook(load('alice.txt'), 'x.txt')
  const all = b.chapters.flatMap((c) => c.paragraphs).join(' ')
  assert.doesNotMatch(all, /Project Gutenberg/)
})

test('condense shortens, chunks stay under limit', () => {
  const b = parseTextBook(load('alice.txt'), 'x.txt')
  const ps = b.chapters[0].paragraphs
  assert.ok(condense(ps).join(' ').length < ps.join(' ').length * 0.7)
  for (const p of ps) for (const c of speechChunks(p)) assert.ok(c.length < 420)
})
