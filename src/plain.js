/**
 * Lossless-JSON sanitization for model-facing tool results.
 *
 * Records are built from optional fields; `undefined` values are valid in JS
 * but not in canonical JSON, so every value crossing a tool output boundary is
 * round-tripped here (which also drops functions and undefined members).
 *
 * @module dsh-lingeye/plain
 */

/** Return the JSON-plain copy of a value. */
export function plain(value) {
  if (value === undefined) return null
  return JSON.parse(JSON.stringify(value))
}
