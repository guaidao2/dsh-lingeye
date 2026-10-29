import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cookieReport, sameOrigin, cleanupCookieHeaders } from '../src/environment.js'

test('cookie diagnostics count only dsh-auth cookies and never expose values', () => {
  const report = cookieReport({ headers: { cookie: 'dsh-auth-one=secret; dsh-auth-two=x; other=value' } })
  assert.equal(report.authCount, 2)
  assert.equal(report.cookieTotal, 3)
  assert.ok(report.headerBytes > 0)
  assert.equal(JSON.stringify(report).includes('secret'), false)
  assert.equal(report.warning, false)
})

test('cookie diagnostics warn near the Node header limit', () => {
  const huge = `dsh-auth-${'x'.repeat(13 * 1024)}=${'y'.repeat(1024)}`
  const report = cookieReport({ headers: { cookie: huge } })
  assert.equal(report.authCount, 1)
  assert.equal(report.warning, true)
})

test('environment writes accept same-origin requests only', () => {
  assert.equal(sameOrigin({ headers: { origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080' } }), true)
  assert.equal(sameOrigin({ headers: { origin: 'https://evil.example', host: '127.0.0.1:3080' } }), false)
  assert.equal(sameOrigin({ headers: {} }), true)
})

test('cookie cleanup keeps the current authority and expires only old auth cookies', () => {
  const current = `dsh-auth-${createHash('sha256').update('127.0.0.1:3080').digest('base64url')}`
  const req = { headers: { host: '127.0.0.1:3080', cookie: `dsh-auth-old=x; ${current}=y; other=z` } }
  const result = cleanupCookieHeaders(req)
  assert.deepEqual(result.removed, ['dsh-auth-old'])
  assert.equal(result.kept, current)
  assert.equal(result.headers.length, 1)
  assert.match(result.headers[0], /Max-Age=0/)
  assert.match(result.headers[0], /Path=\//)
  assert.equal(JSON.stringify(result).includes('=y'), false)
})
