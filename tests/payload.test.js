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

test('ordinary snapshots round-trip unchanged', () => {
  const value = { initialized: true, counts: { intents: 1 }, items: [{ id: 'x' }] }
  assert.deepEqual(cleanRecordPayload(value), value)
})
