/**
 * Report and delivery-bundle rendering for one 灵眼 engagement.
 *
 * The report is generated from one structured snapshot: goals, intents,
 * facts, findings, assets, evidence, flows, retests and attack paths. The
 * export writes the same snapshot into a directory the operator can hand off.
 *
 * @module dsh-lingeye/report
 */

import { mkdir, writeFile, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

/** Format one evidence reference for prose. */
function evidenceRef(id, evidenceById) {
  const evidence = evidenceById.get(id)
  return evidence === undefined ? id : `${id}(${evidence.kind}:${evidence.label})`
}

/** Render the whole engagement as Markdown. */
export function buildReport(data) {
  const engagement = data.engagement
  const lines = ['# 灵眼测试报告', '']
  if (engagement === null) return lines.concat(['（尚未建立交战：请先调用 ly_start。）', '']).join('\n')
  const evidenceById = new Map(data.evidence.map(item => [item.id, item]))
  const assetsById = new Map(data.assets.map(item => [item.id, item]))
  const tested = new Set()
  for (const fact of data.facts) {
    if (fact.evidenceIds.length === 0) continue
    for (const assetId of fact.assetIds) tested.add(assetId)
  }
  for (const finding of data.findings) for (const assetId of finding.assetIds) tested.add(assetId)
  const untested = data.assets.filter(asset => !tested.has(asset.id))

  lines.push(
    `- 目标：${engagement.target}`,
    `- 目的：${engagement.objective}`,
    ...(engagement.projectId && !(data.projectTombstones || []).some(item => item.sessionId === engagement.sessionId && item.projectId === engagement.projectId) ? [`- 项目：${engagement.projectId}`] : []),
    `- 授权：${engagement.authorization === '' ? '（未声明）' : engagement.authorization}`,
    `- 范围：${engagement.scope === '' ? '（未声明）' : engagement.scope}`,
    `- 建立时间：${engagement.createdAt}`,
    '',
    '## 摘要',
    '',
    `- 目标 ${data.goals.length}，意图 ${data.intents.length}，事实 ${data.facts.length}，漏洞 ${data.findings.length}`,
    `- 资产 ${data.assets.length}（已测 ${tested.size}，未测 ${untested.length}），证据 ${data.evidence.length}，数据流 ${data.flows.length}`,
    `- 复测 ${data.retests.length}，攻击路径 ${data.attackPaths.length}`,
    '',
  )

  lines.push('## 目标与判定', '')
  if (data.goals.length === 0) lines.push('（无）')
  for (const goal of data.goals) {
    lines.push(`- [${goal.status}] ${goal.text}${goal.vulnclass === '' ? '' : `（${goal.vulnclass}）`}${goal.acceptance === '' ? '' : ` 验收: ${goal.acceptance}`}${goal.evidenceIds.length === 0 ? '' : ` 证据: ${goal.evidenceIds.join(', ')}`}`)
  }
  lines.push('')

  lines.push('## 探索链路', '')
  if (data.intents.length === 0) lines.push('（无）')
  for (const intent of data.intents) {
    const parents = intent.derivedFromFactIds.length === 0 ? (intent.goalId === undefined ? '无锚点' : intent.goalId) : intent.derivedFromFactIds.join(', ')
    lines.push(`- [${intent.state}] ${intent.id}「${intent.title}」← ${parents}${intent.expectedObservation === '' ? '' : `；预期观测：${intent.expectedObservation}`}`)
  }
  lines.push('')

  lines.push('## 漏洞', '')
  if (data.findings.length === 0) lines.push('（无）')
  for (const finding of data.findings) {
    lines.push(`### ${finding.id} [${finding.severity}] ${finding.title}`, '')
    lines.push(`- 分类：${finding.vulnclass === '' ? '（未分类）' : finding.vulnclass}`)
    lines.push(`- 状态：${finding.status}`)
    if (finding.summary !== '') lines.push(`- 摘要：${finding.summary}`)
    if (finding.description !== '') lines.push(`- 描述：${finding.description}`)
    if (finding.impact !== '') lines.push(`- 影响：${finding.impact}`)
    if (finding.trustBoundary !== '') lines.push(`- 信任边界：${finding.trustBoundary}`)
    lines.push(`- 影响资产：${finding.assetIds.length === 0 ? '（未关联）' : finding.assetIds.map(id => (assetsById.get(id)?.value ?? id)).join(', ')}`)
    lines.push('- 可复现步骤：')
    for (const [index, step] of finding.reproducibleSteps.entries()) lines.push(`  ${index + 1}. ${step}`)
    if (finding.evidenceIds.length > 0) {
      lines.push(`- 证据：${finding.evidenceIds.map(id => evidenceRef(id, evidenceById)).join('；')}`)
    }
    if (finding.reportMarkdown !== '') lines.push('', finding.reportMarkdown)
    lines.push('')
  }

  lines.push('## 资产', '')
  if (data.assets.length === 0) lines.push('（无）')
  for (const asset of data.assets) {
    const parent = asset.parentId === undefined ? '' : ` ← ${assetsById.get(asset.parentId)?.value ?? asset.parentId}`
    lines.push(`- [${asset.type}] ${asset.value}（${asset.origin}${tested.has(asset.id) ? '，已测' : '，未测'}）${parent}`)
  }
  lines.push('')

  lines.push('## 数据流与拼接点', '')
  if (data.flows.length === 0) lines.push('（无）')
  for (const flow of data.flows) {
    lines.push(`- ${flow.source} → ${flow.transform === '' ? '（无变换）' : flow.transform} → ${flow.sink}（置信度 ${flow.confidence}）`)
  }
  lines.push('')

  lines.push('## 证据', '')
  if (data.evidence.length === 0) lines.push('（无）')
  for (const evidence of data.evidence) {
    lines.push(`- ${evidence.id} [${evidence.kind}] ${evidence.label}${evidence.channel === '' ? '' : ` 信道=${evidence.channel}`}${evidence.layers.length === 0 ? '' : ` 层=${evidence.layers.join(' / ')}`}${evidence.content === '' ? '' : ` 正文=${evidence.content.length} 字符`}`)
  }
  lines.push('')

  lines.push('## 复测', '')
  if (data.retests.length === 0) lines.push('（无）')
  for (const retest of data.retests) {
    lines.push(`- ${retest.id} 漏洞 ${retest.findingId}：${retest.status}${retest.verdict === '' ? '' : ` / ${retest.verdict}`}${retest.notes === '' ? '' : `；${retest.notes}`}`)
  }
  lines.push('')

  lines.push('## 攻击路径', '')
  if (data.attackPaths.length === 0) lines.push('（无）')
  for (const path of data.attackPaths) {
    lines.push(`- [${path.status}] ${path.title}${path.summary === '' ? '' : `：${path.summary}`}`)
    for (const step of path.steps) lines.push(`  ${step.seq}. ${step.note === '' ? step.edgeId : `${step.note}（边 ${step.edgeId}）`}`)
  }
  lines.push('')

  lines.push('## 约束', '')
  if (data.constraints.length === 0) lines.push('（无）')
  for (const constraint of data.constraints) lines.push(`- [${constraint.kind}] ${constraint.text}`)
  lines.push('')

  const assumed = data.facts.filter(fact => fact.basis === 'assumed')
  const negative = data.facts.filter(fact => fact.basis === 'negative')
  lines.push('## 信念缺口', '')
  lines.push('### 仍依赖的假设')
  if (assumed.length === 0) lines.push('（无）')
  for (const fact of assumed) lines.push(`- ${fact.id}：${fact.detail}（置信度 ${fact.confidence}）`)
  lines.push('### 否定证据')
  if (negative.length === 0) lines.push('（无）')
  for (const fact of negative) lines.push(`- ${fact.id}：${fact.detail}`)
  lines.push('### 未测资产')
  if (untested.length === 0) lines.push('（无）')
  for (const asset of untested) lines.push(`- ${asset.type} ${asset.value}`)
  lines.push('')

  const openGoals = data.goals.filter(goal => goal.status === 'open')
  lines.push('## 未完成项', '')
  if (openGoals.length === 0 && data.intents.every(intent => intent.state !== 'blocked')) {
    lines.push('（无明确的未完成目标或阻塞意图）')
  } else {
    for (const goal of openGoals) lines.push(`- 目标未达成：${goal.text}`)
    for (const intent of data.intents.filter(item => item.state === 'blocked')) lines.push(`- 意图阻塞：${intent.id}「${intent.title}」`)
  }
  lines.push('')
  return lines.join('\n')
}

/** One finding as a standalone Markdown file. */
function findingMarkdown(finding, data) {
  const assetsById = new Map(data.assets.map(item => [item.id, item]))
  const lines = [
    `# ${finding.title}`,
    '',
    `- 编号：${finding.id}`,
    `- 严重度：${finding.severity}`,
    `- 分类：${finding.vulnclass === '' ? '（未分类）' : finding.vulnclass}`,
    `- 状态：${finding.status}`,
    `- 影响资产：${finding.assetIds.length === 0 ? '（未关联）' : finding.assetIds.map(id => (assetsById.get(id)?.value ?? id)).join(', ')}`,
  ]
  if (finding.trustBoundary !== '') lines.push(`- 信任边界：${finding.trustBoundary}`)
  lines.push('', '## 描述', '', finding.description === '' ? '（无）' : finding.description)
  lines.push('', '## 影响', '', finding.impact === '' ? '（无）' : finding.impact)
  lines.push('', '## 可复现步骤', '')
  for (const [index, step] of finding.reproducibleSteps.entries()) lines.push(`${index + 1}. ${step}`)
  if (finding.reportMarkdown !== '') lines.push('', '## 详细报告', '', finding.reportMarkdown)
  return lines.join('\n')
}

/**
 * Write the delivery bundle for one engagement.
 * @param data - store snapshot.
 * @param options - `{ cwd?, dir? }`; a missing dir goes to `<cwd>/lingeye/<engagement>`.
 * @returns `{ dir, files }`.
 */
export async function buildExportBundle(data, options = {}) {
  const engagement = data.engagement
  if (engagement === null) throw new Error('engagement is not initialized')
  const base = options.dir !== undefined && options.dir !== ''
    ? resolve(options.dir)
    : join(options.cwd ?? process.cwd(), 'lingeye', engagement.id)
  await mkdir(base, { recursive: true })
  await mkdir(join(base, 'findings'), { recursive: true })
  await mkdir(join(base, 'evidence'), { recursive: true })
  const files = []
  const write = async (name, content) => {
    const target = join(base, name)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, content, 'utf8')
    files.push(target)
  }
  await write('report.md', buildReport(data))
  await write('findings.json', JSON.stringify(data.findings, null, 2))
  await write('assets.json', JSON.stringify(data.assets, null, 2))
  await write('graph.json', JSON.stringify({
    goals: data.goals, intents: data.intents, facts: data.facts, edges: data.edges, hints: data.hints,
  }, null, 2))
  const coverageTested = new Set()
  for (const fact of data.facts) {
    if (fact.evidenceIds.length === 0) continue
    for (const assetId of fact.assetIds) coverageTested.add(assetId)
  }
  for (const finding of data.findings) for (const assetId of finding.assetIds) coverageTested.add(assetId)
  await write('coverage.json', JSON.stringify({
    total: data.assets.length,
    tested: data.assets.filter(asset => coverageTested.has(asset.id)).length,
    assets: data.assets,
  }, null, 2))
  await write('retests.json', JSON.stringify(data.retests, null, 2))
  for (const finding of data.findings) {
    await write(join('findings', `${finding.id}.md`), findingMarkdown(finding, data))
  }
  for (const evidence of data.evidence) {
    if (evidence.content !== '') {
      await write(join('evidence', `${evidence.id}.txt`), evidence.content)
    } else if (evidence.refPath !== '' && existsSync(evidence.refPath)) {
      const target = join(base, 'evidence', `${evidence.id}-${basename(evidence.refPath)}`)
      await copyFile(evidence.refPath, target)
      files.push(target)
    }
  }
  return { dir: base, files }
}
