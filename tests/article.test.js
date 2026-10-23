/** Documentation consistency checks for the philosophy articles. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const articleDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'article')
const files = ['lingeye-philosophy.md', 'lingeye-cognition.md', 'lingeye-references.md']

function readArticle(name) {
  return readFileSync(resolve(articleDir, name), 'utf8')
}

test('philosophy articles are valid UTF-8 and non-trivial', () => {
  for (const name of files) {
    const text = readArticle(name)
    assert.ok(text.length > 1000, `${name} looks too short`)
    assert.equal(text.includes('\uFFFD'), false, `${name} contains replacement characters`)
    assert.match(text, /\n$/, `${name} should end with a newline`)
  }
})

test('the cognition article keeps its required concepts', () => {
  const text = readArticle('lingeye-cognition.md')
  for (const term of ['投影', '寻路', '自维持', '归纳', '证伪', '因果一致性', '可证伪']) {
    assert.ok(text.includes(term), `missing concept: ${term}`)
  }
})

test('local markdown links in the articles resolve', () => {
  for (const name of files) {
    const text = readArticle(name)
    for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1]
      if (/^[a-z]+:\/\//i.test(target) || target.startsWith('#') || target.startsWith('mailto:')) continue
      const path = target.split('#')[0]
      assert.ok(existsSync(resolve(articleDir, path)), `${name} links to missing ${path}`)
    }
  }
})

test('references include the FakeAGI source papers and theory anchors', () => {
  const text = readArticle('lingeye-references.md')
  for (const term of ['FakeAGI', 'PAPER_CONCEPTS.md', 'PAPER_PREREG.md', 'Friston', 'Hume', 'Popper']) {
    assert.ok(text.includes(term), `missing reference: ${term}`)
  }
  assert.match(text, /https:\/\/github\.com\/guaidao2\/FakeAGI/)
})
