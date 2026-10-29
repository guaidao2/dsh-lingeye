import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  candidateGitBashPaths,
  detectGitBashPath,
  explicitGitBashPath,
  isWslBashPath,
  resolveConfig,
} from '../src/gitbash-core.js'

test('detection scans PATH and common locations without touching the registry', () => {
  const fakeRoot = 'C:\\Program Files'
  const paths = candidateGitBashPaths({
    ProgramFiles: fakeRoot,
    LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local',
    USERPROFILE: 'C:\\Users\\tester',
    SystemRoot: 'C:\\Windows',
    PATH: 'C:\\Tools\\git\\cmd;C:\\Windows\\System32',
  })
  assert.ok(paths.includes('C:\\Program Files\\Git\\bin\\bash.exe'))
  assert.ok(paths.includes('C:\\Users\\tester\\AppData\\Local\\Programs\\Git\\bin\\bash.exe'))
  assert.ok(paths.includes('C:\\Tools\\git\\bin\\bash.exe'))
  assert.ok(!paths.includes('C:\\Windows\\System32\\bash.exe'))
})

test('explicit paths must be an existing bash.exe and not the WSL forwarder', () => {
  const dir = mkdtempSync('tests/.tmp-gitbash-')
  try {
    const fake = join(dir, 'bash.exe')
    writeFileSync(fake, '')
    assert.equal(explicitGitBashPath(fake), fake)
    assert.equal(explicitGitBashPath(join(dir, 'not-bash.exe')), undefined)
    assert.equal(explicitGitBashPath('C:\\Windows\\System32\\bash.exe', { SystemRoot: 'C:\\Windows' }), undefined)
    assert.equal(isWslBashPath('C:/Windows/System32/bash.exe', { SystemRoot: 'C:\\Windows' }), true)
    assert.equal(detectGitBashPath(fake, {}, 'win32'), fake)
    assert.equal(detectGitBashPath('C:\\missing\\bash.exe', {}, 'win32'), undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('config defaults keep Git Bash opt-in data separate and bounded', () => {
  const resolved = resolveConfig({})
  assert.equal(resolved.timeoutMs, 120000)
  assert.equal(resolved.maxTimeoutMs, 600000)
  assert.equal(resolved.maxOutputBytes, 65536)
})

test('activation contract registers and disposes the host-global bash tool', () => {
  const source = readFileSync(new URL('../src/gitbash.js', import.meta.url), 'utf8')
  assert.match(source, /ctx\.tools\.register\(bashTool\)/)
  assert.match(source, /disposeTool\(\)/)
  assert.match(source, /system-prompt\/assemble/)
  assert.match(source, /exec\?\.name === 'pwsh'/)
  assert.match(source, /resolveWorkdir/)
})
