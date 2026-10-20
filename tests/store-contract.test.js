/** Regression guard for the attack-path table name. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/store.js', import.meta.url), 'utf8')

test('attack paths are written and read through the declared table mapping', () => {
  assert.match(source, /data\.attackPaths = await this\.rows\(sessionId, TABLE_OF\.path\)/)
  assert.match(source, /domain\.table\(TABLE_OF\.path\)\.put/)
  assert.doesNotMatch(source, /domain\.table\('attackPaths'\)/)
})
