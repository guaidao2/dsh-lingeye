/**
 * The `lingeye` session projection: the Web tab's live view.
 *
 * The fold has a single authoritative sync point — the commander's `ly_state`
 * tool call — because delegated writes land in the storage domain only (a
 * plugin must not append its own session events). `ly_start` and `ly_state`
 * both return the full engagement snapshot, so the projection replaces its
 * value from the result content; a malformed or foreign payload leaves the
 * state untouched.
 *
 * @module dsh-lingeye/projection
 */

import { z } from 'zod'

/** Loose wire schema: the payload is produced and validated host-side. */
const stateSchema = z.any()

/** callId -> tool name for calls whose result has not been folded yet. */
const pendingCalls = new Map()

/** Serialize one tool-result content block array into its text payload. */
function resultText(message) {
  const blocks = Array.isArray(message?.content) ? message.content : []
  const parts = []
  for (const block of blocks) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    }
  }
  return parts.join('\n')
}

/** Parse a JSON object payload, or undefined. */
function parseObject(text) {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  try {
    const value = JSON.parse(trimmed)
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Fold one committed session event into the Web view.
 *
 * Live writes publish a whole-state `plugin:lingeye/state` record; `ly_start`
 * and `ly_state` results remain the replay/fallback path. A malformed or
 * foreign payload leaves the state untouched.
 *
 * @param state - previous state (null before the first event).
 * @param event - committed session event.
 * @returns next state, or the same reference when the event is irrelevant.
 */
export function foldLingeyeEvent(state, event) {
  if (event.type === 'plugin:lingeye/state' && event.data?.initialized === true) {
    return event.data
  }
  if (event.type === 'tool/call' && typeof event.data?.name === 'string') {
    if (pendingCalls.size > 2000) pendingCalls.clear()
    pendingCalls.set(String(event.data.callId), event.data.name)
    return state
  }
  if (event.type === 'tool/result') {
    const callId = String(event.data?.message?.toolCallId ?? event.data?.callId)
    const toolName = pendingCalls.get(callId)
    if (toolName === undefined) return state
    pendingCalls.delete(callId)
    if (toolName !== 'ly_state' && toolName !== 'ly_start') return state
    const payload = parseObject(resultText(event.data.message))
    if (payload !== undefined && payload.initialized === true) return payload
    return state
  }
  return state
}

/** Register the `lingeye` projection unit on the session-projection registry. */
export function registerProjection(ctx) {
  ctx.inject(['sessionProjections'], (scope) => {
    scope.sessionProjections.register({
      key: 'lingeye',
      stateSchema,
      init: () => null,
      apply: foldLingeyeEvent,
      wire: {
        viewSchema: stateSchema,
        view: state => state,
      },
      // v2: the result call id is the tool message id, not a bare data field.
      // v3: write-triggered plugin records carry the whole state.
      // v4: those records also carry counts and the rendered report.
      stateVersion: 4,
    })
  })
}
