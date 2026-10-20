/**
 * Pure helpers of the built-in Windows ACL workaround.
 *
 * The plugin's `apply` is exercised through a real DSH boot; these tests cover
 * the string transformations that are easy to regress without a Windows host.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bootstrapSource, stripOwnNodeOptions } from '../src/acl-patch.js'

test('stripOwnNodeOptions removes stable and legacy lingeye entries', () => {
  const current = [
    '--max-old-space-size=4096',
    '--require="C:\\Program Files\\other\\hook.cjs"',
    '--require=C:\\Users\\me\\.dsh\\lingeye-acl-patch\\bootstrap.cjs',
    '--require=C:\\Users\\me\\.dsh\\profiles\\desktop\\node_modules\\dsh-lingeye\\vendor\\acl-sandbox-patch\\preload.cjs',
  ].join(' ')
  assert.deepEqual(stripOwnNodeOptions(current), [
    '--max-old-space-size=4096',
    '--require="C:\\Program Files\\other\\hook.cjs"',
  ])
})

test('stripOwnNodeOptions preserves an independently installed upstream patch', () => {
  const current = '--require=C:\\tools\\dsh-acl-sandbox-patch\\preload.cjs'
  assert.deepEqual(stripOwnNodeOptions(current), [current])
})

test('bootstrapSource gates on the env flag and catches a missing preload', () => {
  const source = bootstrapSource('C:\\Users\\me\\.dsh\\lingeye-acl-patch\\preload.cjs')
  assert.ok(source.includes('process.env.DSH_LINGEYE_ACL_PATCH'))
  assert.ok(source.includes('require("C:\\\\Users\\\\me\\\\.dsh\\\\lingeye-acl-patch\\\\preload.cjs")'))
  assert.ok(source.includes('catch'))
})
