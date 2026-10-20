/**
 * Build a session-record-safe payload for the live projection.
 *
 * Session plugin records must be losslessly JSON-serializable. Store rows
 * routinely carry `undefined` optional fields (`activity.intentId`,
 * `asset.parentId`, `evidence.findingId`), and the session layer rejects such
 * a payload. This cleaner removes undefined object keys and undefined array
 * entries (instead of silently turning them into null), rejects functions,
 * symbols, BigInt and cycles, and caps evidence bodies so one write cannot
 * bloat the durable session log.
 *
 * @param state - full engagement snapshot.
 * @returns lossless plain JSON, or undefined when the value cannot round-trip.
 */

const EVIDENCE_CONTENT_LIMIT = 800

function walk(value, seen) {
  if (value === null) return null
  const type = typeof value
  if (type === 'string' || type === 'boolean') return value
  if (type === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite number')
    return value
  }
  if (type === 'undefined') return undefined
  if (type !== 'object') throw new TypeError(`unsupported ${type}`)
  if (seen.has(value)) throw new TypeError('cycle')
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      const items = []
      for (const item of value) {
        const next = walk(item, seen)
        if (next !== undefined) items.push(next)
      }
      return items
    }
    const out = {}
    for (const [key, item] of Object.entries(value)) {
      const next = walk(item, seen)
      if (next !== undefined) out[key] = next
    }
    return out
  } finally {
    seen.delete(value)
  }
}

/**
 * Trim heavy fields for the live projection without changing stored data.
 * Evidence bodies are capped and `size` is rewritten to the capped character
 * count so the report and the tab agree.
 * @param state - engagement snapshot.
 * @returns state with trimmed evidence bodies.
 */
export function trimProjectionState(state) {
  if (!Array.isArray(state.evidence)) return state
  return {
    ...state,
    evidence: state.evidence.map(evidence => {
      if (typeof evidence.content !== 'string' || evidence.content.length <= EVIDENCE_CONTENT_LIMIT) return evidence
      const content = `${evidence.content.slice(0, EVIDENCE_CONTENT_LIMIT)}…`
      return { ...evidence, content, size: content.length }
    }),
  }
}

/**
 * @param state - engagement snapshot.
 * @returns a record-safe payload with trimmed evidence bodies.
 */
export function cleanRecordPayload(state) {
  const projection = trimProjectionState(state)
  try {
    return walk(projection, new WeakSet())
  } catch {
    return undefined
  }
}
