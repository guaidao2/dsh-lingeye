/**
 * Make one host snapshot safe for `appendPluginRecord`.
 *
 * Session plugin records must be losslessly JSON-serializable. Store rows
 * routinely carry `undefined` optional fields (`activity.intentId`,
 * `asset.parentId`, `evidence.findingId`), and the session layer rejects such
 * a payload instead of silently dropping the key. A JSON round trip removes
 * those keys; any non-serializable value (BigInt, cycle) yields undefined.
 *
 * @param value - candidate record payload.
 * @returns lossless plain JSON, or undefined when the value cannot round-trip.
 */
export function cleanRecordPayload(value) {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return undefined
  }
}
