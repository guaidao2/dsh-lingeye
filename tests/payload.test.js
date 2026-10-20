/** Payload cleanup tests for the live projection record. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanRecordPayload } from '../src/payload.js'

test('undefined optional fields are removed instead of failing the record', () => {
  const clean = cleanRecordPayload({
    activity: { id: 'activity-1', intentId: undefined },
    asset: { id: 'asset-1', parentId: undefined, value: 'example.com' },
  })
  assert.deepEqual(clean, {
    activity: { id: 'activity-1' },
    asset: { id: 'asset-1', value: 'example.com' },
  })
})

test('undefined array entries are dropped instead of becoming null', () => {
  const clean = cleanRecordPayload({ values: [1, undefined, 2] })
  assert.deepEqual(clean, { values: [1, 2] })
})

test('evidence bodies are capped for the durable record', () => {
  const clean = cleanRecordPayload({ evidence: [{ id: 'evidence-1', content: 'x'.repeat(1000), size: 1000 }] })
  assert.equal(clean.evidence[0].content.length, 801)
  assert.ok(clean.evidence[0].content.endsWith('…'))
  assert.equal(clean.evidence[0].size, clean.evidence[0].content.length)
})

test('non-finite numbers are rejected instead of being rewritten', () => {
  assert.equal(cleanRecordPayload({ confidence: Number.NaN }), undefined)
  assert.equal(cleanRecordPayload({ confidence: Infinity }), undefined)
})

test('ordinary snapshots round-trip unchanged', () => {
  const value = { initialized: true, counts: { intents: 1 }, items: [{ id: 'x' }] }
  assert.deepEqual(cleanRecordPayload(value), value)
})

