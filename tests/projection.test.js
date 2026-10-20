/** Fold tests for the Web tab projection. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { foldLingeyeEvent } from '../src/projection.js'

const state = {
  initialized: true,
  engagement: { target: 'example.com' },
  counts: { goals: 1, intents: 1, facts: 0, findings: 0 },
}

test('a live plugin record replaces the projection state', () => {
  const next = foldLingeyeEvent(null, { type: 'plugin:lingeye/state', data: state })
  assert.equal(next, state)
})

test('a foreign or unfinished record is ignored', () => {
  const previous = { initialized: true }
  assert.equal(foldLingeyeEvent(previous, { type: 'plugin:lingeye/state', data: { initialized: false } }), previous)
  assert.equal(foldLingeyeEvent(previous, { type: 'plugin:other/state', data: state }), previous)
})

test('ly_state results still fold as the replay/fallback path', () => {
  const withCall = foldLingeyeEvent(null, {
    type: 'tool/call',
    data: { callId: 'call-1', name: 'ly_state' },
  })
  assert.equal(withCall, null)
  const next = foldLingeyeEvent(withCall, {
    type: 'tool/result',
    data: {
      message: {
        toolCallId: 'call-1',
        content: [{ type: 'text', text: JSON.stringify(state) }],
      },
    },
  })
  assert.deepEqual(next, state)
})

test('an unrelated tool result keeps the same state reference', () => {
  const previous = { initialized: true }
  const next = foldLingeyeEvent(previous, {
    type: 'tool/result',
    data: { message: { toolCallId: 'missing', content: [] } },
  })
  assert.equal(next, previous)
})
