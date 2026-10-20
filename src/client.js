/**
 * dsh-lingeye Web client half: the 灵眼渗透测试模式 view tab.
 *
 * Hand-written `window.__ModuleLoader__` factory — no bundler. Platform
 * modules (React, locale, slots) arrive through the injected `require`.
 * Live state arrives through the `lingeye` session projection; the tab is
 * registered only while the current session runs the 灵眼 mode.
 */

window.__ModuleLoader__.load({
  id: 'dsh-lingeye',
  factory(require) {
    const React = require('react')
    const module = { exports: {} }
    const exports = module.exports

    const NS = 'lingeye'
    const h = React.createElement
    let clientCtx

    const zh = {
      tab: '灵眼',
      empty: '灵眼渗透测试模式尚未开始：在会话里调用 ly_start 建立本次测试。',
      loading: '正在加载灵眼记录…',
    }
    const en = {
      tab: 'Lingeye',
      empty: 'The Lingeye pentest mode has not started: call ly_start in this session.',
      loading: 'Loading Lingeye records…',
    }

    /* ---------------------------------------------------------------- colors */

    const C = {
      text: 'var(--dsw-alias-label-primary, #1b1b1f)',
      muted: 'var(--dsw-alias-label-secondary, #60646c)',
      faint: 'var(--dsw-alias-label-tertiary, #8b8d98)',
      border: '0.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.28))',
      layer: 'var(--dsw-alias-bg-layer-1, rgba(127,127,127,.06))',
      layer2: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.1))',
      brand: 'var(--dsw-alias-brand-primary, #4f46e5)',
      error: 'var(--dsw-alias-state-error, #e5484d)',
      warn: 'var(--dsw-alias-state-warn, #f5a524)',
      success: 'var(--dsw-alias-state-success, #30a46c)',
      info: 'var(--dsw-alias-state-info, #6e56cf)',
    }

    const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
    const SEV_COLOR = { critical: C.error, high: C.error, medium: C.warn, low: C.success, info: C.muted }
    const STATE_COLOR = {
      open: C.faint, running: C.warn, paused: C.info, done: C.success,
      blocked: C.error, exhausted: C.info, stopped: C.faint, deleted: C.faint,
      met: C.success, abandoned: C.faint,
    }
    const BASIS_COLOR = { observed: C.success, inferred: C.info, assumed: C.warn, negative: C.error }

    const S = {
      root: { boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', height: '100%', padding: '16px 20px', overflowX: 'hidden', overflowY: 'auto', color: C.text, fontSize: '13px', lineHeight: 1.5 },
      card: { flex: 'none', border: C.border, borderRadius: '10px', padding: '14px 16px', background: C.layer },
      cardTitle: { margin: '0 0 10px', fontSize: '13px', fontWeight: 600, color: C.text, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px' },
      kv: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 },
      kvLabel: { fontSize: '11px', color: C.faint },
      kvValue: { fontSize: '13px', color: C.text, overflowWrap: 'anywhere' },
      badge: { display: 'inline-flex', alignItems: 'center', padding: '0 6px', borderRadius: '999px', fontSize: '11px', lineHeight: '18px', border: C.border, color: C.muted },
      tabBar: { display: 'flex', gap: '4px', flexWrap: 'wrap', borderBottom: C.border, paddingBottom: '6px', flex: 'none' },
      tab: { border: 'none', background: 'transparent', color: C.muted, cursor: 'pointer', padding: '4px 10px', borderRadius: '6px', fontSize: '12px' },
      tabActive: { background: C.layer2, color: C.text, fontWeight: 600 },
      list: { display: 'flex', flexDirection: 'column', gap: '8px', margin: 0, padding: 0, listStyle: 'none' },
      item: { border: C.border, borderRadius: '8px', padding: '10px 12px', background: 'transparent' },
      itemHead: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginBottom: '4px' },
      itemTitle: { fontWeight: 600, color: C.text },
      detail: { color: C.muted, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: '4px 0 0' },
      code: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '12px', background: C.layer2, border: C.border, borderRadius: '6px', padding: '8px 10px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '320px', overflowY: 'auto', margin: 0 },
      muted: { color: C.muted },
      faint: { color: C.faint },
      table: { width: '100%', borderCollapse: 'collapse', fontSize: '12px' },
      th: { textAlign: 'left', padding: '4px 8px', borderBottom: C.border, color: C.faint, fontWeight: 500 },
      td: { padding: '5px 8px', borderBottom: '0.5px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16))', verticalAlign: 'top', overflowWrap: 'anywhere' },
      bar: { height: '6px', borderRadius: '999px', background: C.layer2, overflow: 'hidden' },
      barFill: { height: '100%', background: C.brand },
      empty: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '160px', color: C.muted, padding: '24px', textAlign: 'center' },
      button: { border: C.border, background: C.layer2, color: C.text, borderRadius: '6px', padding: '3px 10px', cursor: 'pointer', fontSize: '12px' },
    }

    /* --------------------------------------------------------------- helpers */

    function fmtValue(value) {
      return value === undefined || value === null || value === '' ? '（未声明）' : String(value)
    }

    function idNum(item) {
      const match = /-(\d+)$/.exec(item.id || '')
      return match === null ? 0 : Number(match[1])
    }

    function badge(text, color) {
      return h('span', { style: { ...S.badge, color: color || C.muted } }, text)
    }

    function kv(label, value) {
      return h('div', { style: S.kv, key: label },
        h('span', { style: S.kvLabel }, label),
        h('span', { style: S.kvValue }, fmtValue(value)))
    }

    function card(title, body, extra) {
      return h('section', { style: S.card },
        h('h2', { style: S.cardTitle }, h('span', null, title), extra || null),
        body)
    }

    function Stat(label, value) {
      return h('div', { style: { ...S.item, padding: '8px 10px' }, key: label },
        h('div', { style: { fontSize: '18px', fontWeight: 600 } }, String(value)),
        h('div', { style: S.kvLabel }, label))
    }

    function emptyState(text) {
      return h('div', { style: S.empty }, h('span', null, text))
    }

    function testedAssetIds(data) {
      const tested = new Set()
      for (const fact of data.facts || []) {
        if (!fact.evidenceIds || fact.evidenceIds.length === 0) continue
        for (const assetId of fact.assetIds || []) tested.add(assetId)
      }
      for (const finding of data.findings || []) for (const assetId of finding.assetIds || []) tested.add(assetId)
      return tested
    }

    function assetName(data, assetId) {
      const asset = (data.assets || []).find(item => item.id === assetId)
      return asset === undefined ? assetId : `${asset.type} ${asset.value}`
    }

    function evidenceLabel(data, evidenceId) {
      const evidence = (data.evidence || []).find(item => item.id === evidenceId)
      return evidence === undefined ? evidenceId : `${evidence.id}（${evidence.kind}：${evidence.label}）`
    }

    function findingOf(data, findingId) {
      return (data.findings || []).find(item => item.id === findingId)
    }

    /* ------------------------------------------------------------ sub views */

    function Overview({ data }) {
      const engagement = data.engagement || {}
      const counts = data.counts || {}
      const tested = testedAssetIds(data)
      const assets = data.assets || []
      const total = assets.length
      const covered = assets.filter(asset => tested.has(asset.id)).length
      const percent = total === 0 ? 0 : Math.round((covered * 100) / total)
      const assumed = (data.facts || []).filter(fact => fact.basis === 'assumed')
      const negative = (data.facts || []).filter(fact => fact.basis === 'negative')
      const untested = assets.filter(asset => !tested.has(asset.id))
      const hints = (data.hints || []).filter(hint => hint.state === 'active')
      const activity = (data.activity || []).slice(-6).reverse()

      return h('div', { style: { display: 'grid', gap: '12px' } },
        card('交战',
          h('div', { style: S.grid },
            kv('目标', engagement.target), kv('目的', engagement.objective),
            kv('授权', engagement.authorization), kv('范围', engagement.scope),
            kv('状态', engagement.status), kv('建立时间', engagement.createdAt))),
        card('计数',
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: '8px' } },
            Stat('目标', counts.goals || 0), Stat('意图', counts.intents || 0),
            Stat('事实', counts.facts || 0), Stat('漏洞', counts.findings || 0),
            Stat('资产', counts.assets || 0), Stat('证据', counts.evidence || 0))),
        card('资产覆盖',
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
            h('div', { style: { display: 'flex', justifyContent: 'space-between' } },
              h('span', null, `${covered} / ${total} 已测`),
              h('span', { style: S.faint }, `${percent}%`)),
            h('div', { style: S.bar }, h('div', { style: { ...S.barFill, width: `${percent}%` } })))),
        card('目标',
          (data.goals || []).length === 0 ? h('p', { style: S.faint }, '（无）') : h('ul', { style: S.list },
            (data.goals || []).map(goal => h('li', { key: goal.id, style: S.item },
              h('div', { style: S.itemHead }, badge(goal.status, STATE_COLOR[goal.status]), h('span', { style: S.itemTitle }, goal.text)))))),
        card('信念缺口',
          h('div', { style: { display: 'grid', gap: '8px' } },
            h('div', null,
              h('div', { style: S.kvLabel }, `未验证假设（${assumed.length}）`),
              h('ul', { style: S.list },
                assumed.slice(0, 5).map(fact => h('li', { key: fact.id, style: S.item },
                  h('div', { style: S.itemHead }, badge('assumed', BASIS_COLOR.assumed), h('span', { style: S.itemTitle }, fact.detail)))))),
            h('div', null,
              h('div', { style: S.kvLabel }, `否定证据（${negative.length}）`),
              h('ul', { style: S.list },
                negative.slice(0, 5).map(fact => h('li', { key: fact.id, style: S.item },
                  h('div', { style: S.itemHead }, badge('negative', BASIS_COLOR.negative), h('span', { style: S.itemTitle }, fact.detail)))))),
            h('div', null,
              h('div', { style: S.kvLabel }, `未测资产（${untested.length}）`),
              h('div', { style: { ...S.muted, marginTop: '4px' } },
                untested.slice(0, 8).map(asset => asset.type + ' ' + asset.value).join('，') || '（无）')))),
        card('活跃提示',
          hints.length === 0 ? h('p', { style: S.faint }, '（无）') : h('ul', { style: S.list },
            hints.slice(-5).map(hint => h('li', { key: hint.id, style: S.item }, h('div', { style: S.detail }, hint.text))))),
        card('最近活动',
          activity.length === 0 ? h('p', { style: S.faint }, '（无）') : h('ul', { style: S.list },
            activity.map(item => h('li', { key: item.id, style: S.item },
              h('div', { style: S.itemHead },
                badge(item.worker || 'agent', C.muted),
                h('span', { style: S.itemTitle }, item.summary || item.kind),
                h('span', { style: S.faint }, item.createdAt)))))),
      )
    }

    function Explore({ data }) {
      const intents = [...(data.intents || [])].sort((a, b) => idNum(a) - idNum(b))
      if (intents.length === 0) return card('探索链路', h('p', { style: S.faint }, '（还没有意图）'))
      return h('div', { style: { display: 'grid', gap: '10px' } },
        intents.map((intent) => {
          const facts = (data.facts || []).filter(fact => fact.intentId === intent.id)
          const findings = (data.findings || []).filter(finding => finding.intentId === intent.id)
          const anchors = intent.derivedFromFactIds && intent.derivedFromFactIds.length > 0
            ? 'derived from ' + intent.derivedFromFactIds.join(', ')
            : (intent.goalId ? 'spawned by ' + intent.goalId : '无锚点')
          return h('section', { key: intent.id, style: S.card },
            h('div', { style: S.itemHead },
              badge(intent.state, STATE_COLOR[intent.state]),
              h('span', { style: S.itemTitle }, intent.title),
              h('span', { style: S.faint }, intent.id + ' · ' + anchors)),
            intent.detail ? h('p', { style: S.detail }, intent.detail) : null,
            intent.expectedObservation ? h('p', { style: S.detail }, '预期观测：' + intent.expectedObservation) : null,
            intent.assetIds && intent.assetIds.length > 0
              ? h('p', { style: { ...S.faint, margin: '4px 0 0' } }, '资产：' + intent.assetIds.map(assetId => assetName(data, assetId)).join('，'))
              : null,
            facts.length > 0 ? h('ul', { style: { ...S.list, marginTop: '8px' } },
              facts.map(fact => h('li', { key: fact.id, style: S.item },
                h('div', { style: S.itemHead },
                  badge(fact.basis, BASIS_COLOR[fact.basis]),
                  badge(fact.kind, C.muted),
                  h('span', { style: S.faint }, '置信度 ' + fact.confidence)),
                h('div', { style: S.detail }, fact.detail)))) : null,
            findings.length > 0 ? h('ul', { style: { ...S.list, marginTop: '8px' } },
              findings.map(finding => h('li', { key: finding.id, style: S.item },
                h('div', { style: S.itemHead },
                  badge(finding.severity, SEV_COLOR[finding.severity]),
                  h('span', { style: S.itemTitle }, finding.title))))) : null,
          )
        }))
    }

    function Assets({ data }) {
      const tested = testedAssetIds(data)
      const assets = data.assets || []
      if (assets.length === 0) return card('资产', h('p', { style: S.faint }, '（还没有资产）'))
      return card('资产',
        h('table', { style: S.table },
          h('thead', null, h('tr', null,
            h('th', { style: S.th }, 'ID'), h('th', { style: S.th }, '类型'),
            h('th', { style: S.th }, '值'), h('th', { style: S.th }, '来源'),
            h('th', { style: S.th }, '父资产'), h('th', { style: S.th }, '测试'))),
          h('tbody', null, assets.map(asset => h('tr', { key: asset.id },
            h('td', { style: S.td }, asset.id),
            h('td', { style: S.td }, asset.type),
            h('td', { style: S.td }, asset.value),
            h('td', { style: S.td }, asset.origin),
            h('td', { style: S.td }, asset.parentId ? assetName(data, asset.parentId) : '—'),
            h('td', { style: S.td }, tested.has(asset.id) ? badge('已测', C.success) : badge('未测', C.faint)))))))
    }

    function Findings({ data }) {
      const findings = [...(data.findings || [])].sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9))
      if (findings.length === 0) return card('漏洞', h('p', { style: S.faint }, '（还没有漏洞）'))
      return h('div', { style: { display: 'grid', gap: '10px' } },
        findings.map(finding => {
          const retests = (data.retests || []).filter(retest => retest.findingId === finding.id)
          return h('section', { key: finding.id, style: S.card },
            h('div', { style: S.itemHead },
              badge(finding.severity, SEV_COLOR[finding.severity]),
              h('span', { style: S.itemTitle }, finding.title),
              badge(finding.status, C.muted),
              h('span', { style: S.faint }, finding.id + (finding.vulnclass ? ' · ' + finding.vulnclass : ''))),
            finding.description ? h('p', { style: S.detail }, finding.description) : null,
            finding.impact ? h('p', { style: S.detail }, '影响：' + finding.impact) : null,
            finding.trustBoundary ? h('p', { style: S.detail }, '信任边界：' + finding.trustBoundary) : null,
            finding.assetIds && finding.assetIds.length > 0
              ? h('p', { style: { ...S.faint, margin: '4px 0 0' } }, '影响资产：' + finding.assetIds.map(assetId => assetName(data, assetId)).join('，'))
              : null,
            h('div', { style: { marginTop: '8px' } },
              h('div', { style: S.kvLabel }, '可复现步骤'),
              h('ol', { style: { margin: '4px 0 0', paddingLeft: '20px', color: C.text } },
                (finding.reproducibleSteps || []).map((step, index) => h('li', { key: index, style: { whiteSpace: 'pre-wrap' } }, step)))),
            finding.evidenceIds && finding.evidenceIds.length > 0
              ? h('p', { style: { ...S.faint, margin: '6px 0 0' } }, '证据：' + finding.evidenceIds.map(evidenceId => evidenceLabel(data, evidenceId)).join('；'))
              : null,
            retests.length > 0 ? h('p', { style: { ...S.faint, margin: '6px 0 0' } },
              '复测：' + retests.map(retest => `${retest.id} ${retest.verdict || retest.status}`).join('；')) : null,
          )
        }))
    }

    function Evidence({ data }) {
      const evidence = [...(data.evidence || [])].sort((a, b) => idNum(a) - idNum(b))
      if (evidence.length === 0) return card('证据', h('p', { style: S.faint }, '（还没有证据）'))
      return h('div', { style: { display: 'grid', gap: '10px' } },
        evidence.map(item => h('section', { key: item.id, style: S.card },
          h('div', { style: S.itemHead },
            badge(item.kind, C.muted),
            h('span', { style: S.itemTitle }, item.label),
            h('span', { style: S.faint }, item.id),
            item.channel ? badge('信道 ' + item.channel, C.info) : null,
            (item.layers || []).map((layer, index) => badge('层 ' + (index + 1) + ' ' + layer, C.muted))),
          item.refPath ? h('p', { style: { ...S.faint, margin: '4px 0' } }, '文件：' + item.refPath) : null,
          item.content ? h('pre', { style: S.code }, item.content) : h('p', { style: S.faint }, '（正文在文件或外部记录中）'))))
    }

    function Flows({ data }) {
      const flows = data.flows || []
      if (flows.length === 0) return card('数据流与拼接点', h('p', { style: S.faint }, '（还没有数据流）'))
      return card('数据流与拼接点',
        h('ul', { style: S.list }, flows.map(flow => h('li', { key: flow.id, style: S.item },
          h('div', { style: S.itemHead },
            h('span', { style: S.itemTitle }, flow.source),
            h('span', { style: S.faint }, '→'),
            h('span', { style: S.muted }, flow.transform || '（无变换）'),
            h('span', { style: S.faint }, '→'),
            h('span', { style: S.itemTitle }, flow.sink),
            badge('置信度 ' + flow.confidence, C.muted))))))
    }

    function Report({ data }) {
      const [copied, setCopied] = React.useState(false)
      const markdown = typeof data.report === 'string' ? data.report : ''
      if (markdown === '') {
        return card('报告', h('p', { style: S.faint }, '报告由宿主生成：在会话中调用 ly_report（或 ly_state 刷新）后显示。'))
      }
      const copy = () => {
        try {
          navigator.clipboard.writeText(markdown)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          /* clipboard unavailable: ignore */
        }
      }
      return card('报告',
        h('div', null,
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' } },
            h('button', { type: 'button', style: S.button, onClick: copy }, copied ? '已复制' : '复制 Markdown')),
          h('pre', { style: { ...S.code, maxHeight: 'none', fontSize: '12px' } }, markdown)))
    }

    function Retests({ data }) {
      const retests = [...(data.retests || [])].sort((a, b) => idNum(b) - idNum(a))
      if (retests.length === 0) return card('复测', h('p', { style: S.faint }, '（还没有复测记录）'))
      return h('div', { style: { display: 'grid', gap: '10px' } },
        retests.map(retest => {
          const finding = findingOf(data, retest.findingId)
          return h('section', { key: retest.id, style: S.card },
            h('div', { style: S.itemHead },
              badge(retest.status, C.muted),
              retest.verdict ? badge(retest.verdict, retest.verdict === 'fixed' ? C.success : retest.verdict === 'reproduced' ? C.error : C.warn) : null,
              h('span', { style: S.itemTitle }, finding ? finding.title : retest.findingId),
              h('span', { style: S.faint }, retest.id)),
            retest.notes ? h('p', { style: S.detail }, retest.notes) : null,
            retest.finishedAt ? h('p', { style: S.faint }, '完成：' + retest.finishedAt) : null)
        }))
    }

    /* --------------------------------------------------------------- shell */

    const TABS = [
      { id: 'overview', label: '总览', view: Overview },
      { id: 'explore', label: '探索', view: Explore },
      { id: 'assets', label: '资产', view: Assets },
      { id: 'findings', label: '漏洞', view: Findings },
      { id: 'evidence', label: '证据', view: Evidence },
      { id: 'flows', label: '数据流', view: Flows },
      { id: 'report', label: '报告', view: Report },
      { id: 'retests', label: '复测', view: Retests },
    ]

    function LingeyeView(props) {
      const projection = props.useProjection ? props.useProjection('lingeye') : undefined
      const [tab, setTab] = React.useState('overview')
      const [nowTick, setNowTick] = React.useState(Date.now())
      React.useEffect(() => {
        const timer = setInterval(() => setNowTick(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [])
      React.useEffect(() => {
        const sessions = clientCtx?.sessions
        if (sessions !== undefined && typeof sessions.refreshProjections === 'function' && props.sessionId !== undefined) {
          Promise.resolve(sessions.refreshProjections(props.sessionId)).catch(() => undefined)
        }
      }, [props.sessionId])
      if (projection === undefined) return emptyState(props.t ? props.t('loading') : '正在加载灵眼记录…')
      if (projection === null || projection.initialized !== true) {
        return emptyState(props.t ? props.t('empty') : '灵眼渗透测试模式尚未开始：在会话里调用 ly_start 建立本次测试。')
      }
      const data = projection
      const active = TABS.find(item => item.id === tab) || TABS[0]
      const counts = data.counts || {}
      const stamp = typeof data.updatedAt === 'string' ? Date.parse(data.updatedAt) : Number.NaN
      const age = Number.isFinite(stamp) ? Math.max(0, Math.floor((nowTick - stamp) / 1000)) : undefined
      const freshness = age === undefined ? '更新时间未知' : age < 2 ? '刚刚更新' : `更新于 ${age} 秒前`
      const refresh = () => {
        const sessions = clientCtx?.sessions
        if (sessions !== undefined && typeof sessions.refreshProjections === 'function' && props.sessionId !== undefined) {
          Promise.resolve(sessions.refreshProjections(props.sessionId)).catch(() => undefined)
        }
      }
      return h('div', { style: S.root, 'data-testid': 'lingeye-view' },
        h('header', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
          h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '8px' } },
            h('h2', { style: { margin: 0, fontSize: '16px' } }, (data.engagement && data.engagement.target) || '灵眼'),
            h('span', { style: S.muted }, (data.engagement && data.engagement.objective) || ''),
            badge(`目标 ${counts.goals || 0}`, C.muted),
            badge(`意图 ${counts.intents || 0}`, C.muted),
            badge(`事实 ${counts.facts || 0}`, C.muted),
            badge(`漏洞 ${counts.findings || 0}`, C.muted)),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h('span', { style: S.faint }, freshness),
            h('button', { type: 'button', style: S.button, onClick: refresh }, '刷新'))),
        h('nav', { style: S.tabBar, 'data-testid': 'lingeye-tabs' },
          TABS.map(item => h('button', {
            key: item.id,
            type: 'button',
            style: tab === item.id ? { ...S.tab, ...S.tabActive } : S.tab,
            'aria-pressed': tab === item.id,
            onClick: () => setTab(item.id),
          }, item.label))),
        h('div', { style: { flex: 1, minHeight: 0 } }, h(active.view, { data })))
    }

    /** Preset id of the mode; copies keep the `lingeye-` prefix. */
    const PRESET = 'lingeye'
    const PRESET_PREFIX = `${PRESET}-`

    function isLingeyePreset(preset) {
      return preset === PRESET || (typeof preset === 'string' && preset.startsWith(PRESET_PREFIX))
    }

    function presetOf(row) {
      const projected = row && row.projectionValues && row.projectionValues.agentPreset
      if (typeof projected === 'string') return projected
      return row && row.agentPreset
    }

    function currentSessionOf(snapshot) {
      if (snapshot.current !== undefined) return snapshot.current
      const entries = Object.entries(snapshot.byId || {})
      const retained = entries.find(([, row]) => row && row.retainedBy && row.retainedBy.mainView > 0)
      return retained ? retained[0] : undefined
    }

    /** Required client services for the mode gate and the tab. */
    const inject = ['slots', 'locale', 'sessions']

    /**
     * Register the 灵眼 tab only for sessions composed from the mode.
     * @param {object} ctx - client root context.
     */
    function apply(ctx) {
      clientCtx = ctx
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'lingeye:dictionaries')
      const t = ctx.locale.bind(NS)
      const sessions = ctx.sessions
      ctx.slots.inject('conversation.view', () => {
        let disposeEntry
        let sessionId
        let enabled
        const sync = () => {
          const snapshot = sessions.list.getSnapshot()
          const current = currentSessionOf(snapshot)
          const row = current === undefined ? undefined : snapshot.byId[current]
          const nextEnabled = current !== undefined && isLingeyePreset(presetOf(row))
          if (current === sessionId && nextEnabled === enabled) return
          if (disposeEntry) disposeEntry()
          disposeEntry = undefined
          sessionId = current
          enabled = nextEnabled
          if (!nextEnabled) return
          disposeEntry = ctx.slots.register({
            name: 'conversation.view',
            id: 'lingeye',
            order: 40,
            locale: NS,
            label: () => t('tab'),
          }, LingeyeView)
        }
        sync()
        const off = sessions.list.subscribe(sync)
        return () => {
          off()
          if (disposeEntry) disposeEntry()
        }
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
