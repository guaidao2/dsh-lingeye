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
      projects: '灵眼项目',
    }
    const en = {
      tab: 'Lingeye',
      empty: 'The Lingeye pentest mode has not started: call ly_start in this session.',
      loading: 'Loading Lingeye records…',
      projects: 'Lingeye projects',
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

    function Overview({ data, sessionId }) {
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
      const projectId = engagement.projectId
      const projectTombstoned = projectId !== undefined && (data.projectTombstones || []).some(item => item.sessionId === sessionId && item.projectId === projectId)

      return h('div', { style: { display: 'grid', gap: '12px' } },
        card('交战',
          h('div', { style: S.grid },
            kv('目标', engagement.target), kv('目的', engagement.objective),
            engagement.projectId && !projectTombstoned ? kv('项目', engagement.projectId) : null,
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
              h('div', { style: S.itemHead }, badge(goal.status, STATE_COLOR[goal.status]), h('span', { style: S.itemTitle }, goal.text)),
              goal.acceptance ? h('p', { style: S.faint }, `验收：${goal.acceptance}`) : null)))),
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

    const GRAPH_NODE_W = 232
    const GRAPH_NODE_H = 84

    /**
     * Build the exploration graph model: seeded columns for a sane first
     * guess, then a small force simulation so related evidence pulls together
     * instead of sitting in rigid rows.
     */
    function buildExplorationGraph(data) {
      const goals = data.goals || []
      const goalNodes = goals.length > 0
        ? goals.map(goal => ({ id: goal.id, kind: 'goal', label: goal.text || (data.engagement && data.engagement.target) || '目标', state: goal.status }))
        : [{ id: 'goal-1', kind: 'goal', label: (data.engagement && data.engagement.target) || '目标', state: 'open' }]
      const intentNodes = (data.intents || []).map(intent => {
        const derived = Array.isArray(intent.derivedFromFactIds) ? intent.derivedFromFactIds : []
        return {
          id: intent.id,
          kind: 'intent',
          label: intent.title,
          state: intent.state,
          derived: derived.length === 0 ? '' : `派生 ${derived[0]}${derived.length > 1 ? ` +${derived.length - 1}` : ''}`,
        }
      })
      const leafNodes = [
        ...(data.facts || []).map(fact => ({ id: fact.id, kind: 'fact', label: fact.detail, basis: fact.basis, confidence: fact.confidence, intentId: fact.intentId })),
        ...(data.findings || []).map(finding => ({ id: finding.id, kind: 'finding', label: finding.title, severity: finding.severity, intentId: finding.intentId })),
      ].sort((a, b) => String(a.intentId || '').localeCompare(String(b.intentId || '')) || idNum(a) - idNum(b))
      const nodes = [...goalNodes, ...intentNodes, ...leafNodes]
      const byId = new Map(nodes.map(node => [node.id, node]))
      const links = []
      const seen = new Set()
      const addLink = (srcId, dstId, kind) => {
        if (!byId.has(srcId) || !byId.has(dstId)) return
        const key = `${srcId}>${dstId}`
        if (seen.has(key)) return
        seen.add(key)
        links.push({ srcId, dstId, kind })
      }
      for (const edge of data.edges || []) {
        if (['spawns', 'yields', 'proves'].includes(edge.kind)) addLink(edge.srcId, edge.dstId, edge.kind)
      }
      for (const intent of data.intents || []) if (intent.goalId) addLink(intent.goalId, intent.id, 'spawns')
      for (const fact of data.facts || []) if (fact.intentId) addLink(fact.intentId, fact.id, 'yields')
      for (const finding of data.findings || []) if (finding.intentId) addLink(finding.intentId, finding.id, 'proves')

      const columns = [goalNodes, intentNodes, leafNodes]
      columns.forEach((column, columnIndex) => {
        column.forEach((node, index) => {
          node.x = 80 + columnIndex * 360
          node.y = 80 + index * 110
          node.w = GRAPH_NODE_W
          node.h = GRAPH_NODE_H
        })
      })

      const byNode = new Map(nodes.map(node => [node.id, node]))
      const linkPairs = links.map(link => [byNode.get(link.srcId), byNode.get(link.dstId)]).filter(pair => pair[0] && pair[1])
      const iterations = nodes.length > 80 ? 100 : 180
      for (let step = 0; step < iterations; step += 1) {
        const fx = new Map()
        const fy = new Map()
        const addForce = (id, x, y) => {
          fx.set(id, (fx.get(id) || 0) + x)
          fy.set(id, (fy.get(id) || 0) + y)
        }
        for (let i = 0; i < nodes.length; i += 1) {
          const a = nodes[i]
          for (let j = i + 1; j < nodes.length; j += 1) {
            const b = nodes[j]
            let dx = (b.x + b.w / 2) - (a.x + a.w / 2)
            let dy = (b.y + b.h / 2) - (a.y + a.h / 2)
            let dist = Math.hypot(dx, dy)
            if (dist < 1) { dx = 1; dy = 1; dist = Math.SQRT2 }
            const minDist = 300
            const push = Math.min(18, (minDist * minDist) / (dist * dist) * 0.8)
            addForce(a.id, (-dx / dist) * push, (-dy / dist) * push)
            addForce(b.id, (dx / dist) * push, (dy / dist) * push)
          }
        }
        for (const [a, b] of linkPairs) {
          const dx = (b.x + b.w / 2) - (a.x + a.w / 2)
          const dy = (b.y + b.h / 2) - (a.y + a.h / 2)
          const dist = Math.hypot(dx, dy) || 1
          const pull = Math.min(8, Math.max(-8, (dist - 380) * 0.005))
          addForce(a.id, (dx / dist) * pull, (dy / dist) * pull)
          addForce(b.id, (-dx / dist) * pull, (-dy / dist) * pull)
        }
        const avgX = nodes.reduce((sum, n) => sum + n.x + n.w / 2, 0) / Math.max(1, nodes.length)
        const avgY = nodes.reduce((sum, n) => sum + n.y + n.h / 2, 0) / Math.max(1, nodes.length)
        for (const node of nodes) {
          const fxx = (fx.get(node.id) || 0) + (avgX - (node.x + node.w / 2)) * 0.002
          const fyy = (fy.get(node.id) || 0) + (avgY - (node.y + node.h / 2)) * 0.002
          node.x += Math.max(-10, Math.min(10, fxx))
          node.y += Math.max(-10, Math.min(10, fyy))
        }
      }
      const minX = Math.min(...nodes.map(node => node.x))
      const minY = Math.min(...nodes.map(node => node.y))
      for (const node of nodes) {
        node.x -= minX
        node.y -= minY
      }
      const contentW = Math.max(1, ...nodes.map(node => node.x + node.w)) + 60
      const contentH = Math.max(1, ...nodes.map(node => node.y + node.h)) + 60
      return { nodes, links, byId, contentW, contentH, viewWidth: Math.max(960, contentW) }
    }

    /** Interactive force-directed view of the exploration chain. */
    function ExplorationGraph({ data }) {
      const model = React.useMemo(() => buildExplorationGraph(data), [data])
      const { nodes, links, byId, contentW, contentH, viewWidth } = model
      const graphSignature = nodes.map(node => node.id).join(',')
      const fittedRef = React.useRef('')
      const containerRef = React.useRef(null)
      const svgRef = React.useRef(null)
      const outerRef = React.useRef(null)
      const fullButtonRef = React.useRef(null)
      const dragRef = React.useRef(null)
      const [view, setView] = React.useState({ x: 0, y: 20, scale: 1 })
      const [selectedId, setSelectedId] = React.useState(null)
      const [fullscreen, setFullscreen] = React.useState(false)
      const toUserPoint = (clientX, clientY) => {
        const svg = svgRef.current
        if (svg === null || typeof svg.getScreenCTM !== 'function') return undefined
        const matrix = svg.getScreenCTM()
        if (matrix === null) return undefined
        const point = svg.createSVGPoint()
        point.x = clientX
        point.y = clientY
        return point.matrixTransform(matrix.inverse())
      }
      const MIN_SCALE = 0.08
      const MAX_SCALE = 2.6
      const zoomAt = (userX, userY, factor) => {
        setView(current => {
          const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * factor))
          const ratio = scale / current.scale
          return {
            scale,
            x: userX - (userX - current.x) * ratio,
            y: userY - (userY - current.y) * ratio,
          }
        })
      }
      const fitAll = () => {
        // The viewBox height is always 560 user units; CSS scaling handles the
        // fullscreen viewport, so fitting must never mix in CSS pixels.
        const viewportHeight = 560
        const rawScale = Math.min((viewWidth - 60) / contentW, (viewportHeight - 60) / contentH, 1.1)
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, rawScale))
        setView({ scale, x: (viewWidth - contentW * scale) / 2, y: (viewportHeight - contentH * scale) / 2 })
      }
      /** Readable first view: fit width, allow vertical pan for dense graphs. */
      const fitReadable = () => {
        const scale = Math.min(MAX_SCALE, Math.max(0.55, Math.min((viewWidth - 60) / contentW, 1.1)))
        setView({ scale, x: (viewWidth - contentW * scale) / 2, y: 20 })
      }
      React.useEffect(() => {
        if (fittedRef.current === graphSignature && !fullscreen) return
        fittedRef.current = graphSignature
        if (fullscreen) fitAll()
        else fitReadable()
      }, [graphSignature, fullscreen])
      React.useEffect(() => {
        if (!fullscreen) return undefined
        const focusables = () => {
          if (outerRef.current === null) return []
          return [...outerRef.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
            .filter(element => !element.disabled && element.getAttribute('aria-hidden') !== 'true')
        }
        const initial = focusables()
        if (initial.length > 0) initial[0].focus()
        else if (outerRef.current !== null) outerRef.current.focus()
        const onKey = event => {
          if (event.key === 'Escape') setFullscreen(false)
          if (event.key !== 'Tab' || outerRef.current === null) return
          const items = focusables()
          if (items.length === 0) return
          const first = items[0]
          const last = items[items.length - 1]
          if (event.shiftKey && (document.activeElement === first || document.activeElement === outerRef.current)) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }
        window.addEventListener('keydown', onKey)
        return () => {
          window.removeEventListener('keydown', onKey)
          if (fullButtonRef.current !== null) fullButtonRef.current.focus()
        }
      }, [fullscreen])
      React.useEffect(() => {
        const svg = svgRef.current
        if (svg === null) return undefined
        const onWheel = event => {
          event.preventDefault()
          const point = toUserPoint(event.clientX, event.clientY)
          if (point === undefined) return
          zoomAt(point.x, point.y, event.deltaY < 0 ? 1.1 : 1 / 1.1)
        }
        svg.addEventListener('wheel', onWheel, { passive: false })
        return () => svg.removeEventListener('wheel', onWheel)
      }, [fullscreen])
      const KIND_LABEL = { goal: '目标', intent: '意图', fact: '事实', finding: '漏洞' }
      const fillOf = (node) => {
        if (node.kind === 'goal') return C.brand
        if (node.kind === 'intent') return node.state === 'done' ? C.success : node.state === 'blocked' ? C.error : C.info
        if (node.kind === 'finding') return C.error
        return BASIS_COLOR[node.basis] || C.muted
      }
      const subOf = (node) => {
        if (node.kind === 'goal') return (data.engagement && data.engagement.target) || '起点'
        if (node.kind === 'intent') return node.derived || node.state || ''
        if (node.kind === 'fact') return `${node.basis} · ${Math.round((Number(node.confidence) || 0) * 100)}%`
        return node.severity || ''
      }
      const EDGE_COLOR = { spawns: C.info, yields: C.success, proves: C.error }
      const EDGE_MARKER = { spawns: 'lingeye-arrow-info', yields: 'lingeye-arrow-success', proves: 'lingeye-arrow-error' }
      const marker = (id, color) => h('marker', {
        id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse',
      }, h('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: color }))
      const edgeOffsets = new Map()
      const outCounts = new Map()
      for (const link of links) {
        const key = `${link.srcId}>${link.dstId}`
        const out = outCounts.get(link.srcId) || 0
        outCounts.set(link.srcId, out + 1)
        edgeOffsets.set(key, out)
      }
      const outTotals = new Map()
      for (const link of links) outTotals.set(link.srcId, (outTotals.get(link.srcId) || 0) + 1)
      const selectedNode = selectedId ? byId.get(selectedId) : undefined
      const selectedLinks = selectedId ? links.filter(link => link.srcId === selectedId || link.dstId === selectedId) : []
      const detailFields = (node) => {
        if (node === undefined) return []
        const raw = node.kind === 'intent'
          ? (data.intents || []).find(item => item.id === node.id)
          : node.kind === 'fact'
            ? (data.facts || []).find(item => item.id === node.id)
            : node.kind === 'finding'
              ? (data.findings || []).find(item => item.id === node.id)
              : (data.goals || []).find(item => item.id === node.id)
        if (raw === undefined) return []
        const fields = []
        for (const [label, key] of [['状态', 'state'], ['优先级', 'priority'], ['依据', 'basis'], ['置信度', 'confidence'], ['严重度', 'severity'], ['类型', 'vulnclass'], ['验收', 'acceptance'], ['预期观测', 'expectedObservation'], ['复现步骤', 'reproducibleSteps'], ['证据', 'evidenceIds'], ['信任边界', 'trustBoundary']]) {
          const value = raw[key]
          if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) continue
          fields.push([label, Array.isArray(value) ? value.join('、') : String(value)])
        }
        return fields.slice(0, 8)
      }
      const legend = [
        ['目标', C.brand], ['意图', C.info], ['事实（按依据）', C.muted], ['漏洞', C.error],
      ].map(([label, color]) => h('span', { key: label, style: { display: 'inline-flex', alignItems: 'center', gap: '4px' } },
        h('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: color, display: 'inline-block' } }), label))
      const edgeLegend = [
        ['spawns', '派生'], ['yields', '产出'], ['proves', '证明'],
      ].map(([kind, label]) => h('span', { key: kind, style: { display: 'inline-flex', alignItems: 'center', gap: '4px' } },
        h('span', { style: { width: '14px', height: '2px', background: EDGE_COLOR[kind], display: 'inline-block' } }), label))
      if (nodes.length === 0) return h('p', { style: S.faint }, '（还没有探索节点）')
      const outerStyle = fullscreen
        ? { position: 'fixed', inset: 0, zIndex: 60, padding: '14px', background: C.layer2, display: 'grid', gap: '8px', gridTemplateRows: 'auto 1fr', userSelect: 'none', WebkitUserSelect: 'none' }
        : { display: 'grid', gap: '8px', userSelect: 'none', WebkitUserSelect: 'none' }
      const canvasHeight = fullscreen ? 'calc(100vh - 96px)' : '560px'
      return h('div', {
        ref: outerRef,
        tabIndex: fullscreen ? -1 : undefined,
        style: outerStyle,
        role: fullscreen ? 'dialog' : undefined,
        'aria-modal': fullscreen ? 'true' : undefined,
        'aria-label': fullscreen ? '灵眼探索图全屏' : undefined,
        onDragStart: event => event.preventDefault(),
      },
        h('div', {
          ref: containerRef,
          style: {
            position: 'relative', overflow: 'hidden', height: canvasHeight,
            border: fullscreen ? 'none' : C.border, borderRadius: fullscreen ? '0' : '10px', background: C.layer2,
            backgroundImage: 'radial-gradient(rgba(127,127,127,.18) 1px, transparent 1px)', backgroundSize: '18px 18px',
          },
        },
        h('svg', {
          ref: svgRef,
          viewBox: `0 0 ${viewWidth} 560`,
          preserveAspectRatio: 'xMidYMid meet',
          style: { display: 'block', width: '100%', height: '100%', touchAction: 'none', cursor: 'grab' },
          role: 'group', 'aria-label': '灵眼探索链路图',
          onPointerDown: event => {
            if (event.button !== 0) return
            const point = toUserPoint(event.clientX, event.clientY)
            if (point === undefined) return
            dragRef.current = { point, ox: view.x, oy: view.y }
            event.currentTarget.setPointerCapture(event.pointerId)
          },
          onPointerMove: event => {
            const drag = dragRef.current
            if (drag === null) return
            const point = toUserPoint(event.clientX, event.clientY)
            if (point === undefined) return
            setView(current => ({ ...current, x: drag.ox + (point.x - drag.point.x), y: drag.oy + (point.y - drag.point.y) }))
          },
          onPointerUp: () => { dragRef.current = null },
          onPointerLeave: () => { dragRef.current = null },
        },
        h('defs', null,
          marker('lingeye-arrow-info', C.info),
          marker('lingeye-arrow-success', C.success),
          marker('lingeye-arrow-error', C.error)),
        h('g', { transform: `translate(${view.x} ${view.y}) scale(${view.scale})` },
          links.map((link, index) => {
            const from = byId.get(link.srcId)
            const to = byId.get(link.dstId)
            if (!from || !to) return null
            const forward = to.x >= from.x
            const x1 = forward ? from.x + from.w : from.x
            const x2 = forward ? to.x - 8 : to.x + to.w + 8
            const total = outTotals.get(link.srcId) || 1
            const offset = (edgeOffsets.get(`${link.srcId}>${link.dstId}`) || 0) + 1
            const y1 = from.y + 14 + (from.h - 28) * (offset / (total + 1))
            const y2 = to.y + to.h / 2
            const dx = Math.max(50, Math.abs(x2 - x1) / 2)
            return h('path', {
              key: `edge-${index}`,
              d: forward ? `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}` : `M${x1},${y1} C${x1 - dx},${y1} ${x2 + dx},${y2} ${x2},${y2}`,
              fill: 'none', stroke: EDGE_COLOR[link.kind] || C.faint, 'stroke-width': 1.4,
              'stroke-linecap': 'round', opacity: 0.66,
              'marker-end': `url(#${EDGE_MARKER[link.kind] || 'lingeye-arrow-info'})`,
            })
          }),
          nodes.map(node => {
            const color = fillOf(node)
            const isSelected = selectedId === node.id
            return h('foreignObject', {
              key: node.id, x: node.x, y: node.y, width: node.w, height: node.h,
              style: { overflow: 'visible' },
              onPointerDown: event => event.stopPropagation(),
              onClick: event => { event.stopPropagation(); setSelectedId(isSelected ? null : node.id) },
            },
            h('div', {
              role: 'button',
              tabIndex: 0,
              'aria-label': `${KIND_LABEL[node.kind] || node.kind} ${node.label || node.id}`,
              style: {
                boxSizing: 'border-box', width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
                justifyContent: 'center', gap: '3px', padding: '8px 12px 8px 16px', cursor: 'pointer',
                borderRadius: '10px', border: `1px solid ${isSelected ? color : C.border}`,
                borderLeft: `4px solid ${color}`, background: C.layer,
                boxShadow: isSelected ? `0 0 0 2px ${color}33` : 'none',
                userSelect: 'none', WebkitUserSelect: 'none',
              },
              onKeyDown: event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setSelectedId(isSelected ? null : node.id)
                }
              },
            },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: C.faint } },
              h('span', { style: { color, fontWeight: 600 } }, KIND_LABEL[node.kind] || node.kind),
              h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, node.id)),
            h('div', { style: { fontSize: '12px', fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, node.label || ''),
            h('div', { style: { fontSize: '10px', color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, subOf(node))))
          }))),
        h('div', { style: { position: 'absolute', left: '10px', top: '10px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', maxWidth: 'calc(100% - 320px)', padding: '5px 8px', borderRadius: '7px', border: C.border, background: C.layer, fontSize: '10px', color: C.faint } },
          legend, edgeLegend),
        h('div', { style: { position: 'absolute', right: '10px', bottom: '10px', display: 'flex', alignItems: 'center', gap: '4px', padding: '4px', borderRadius: '7px', border: C.border, background: C.layer } },
          h('span', { style: { marginRight: '4px', fontSize: '10px', color: C.faint } }, '拖动平移 · 滚轮缩放'),
          h('button', { type: 'button', style: S.button, onClick: () => zoomAt(viewWidth / 2, 280, 1.15) }, '+'),
          h('button', { type: 'button', style: S.button, onClick: () => zoomAt(viewWidth / 2, 280, 1 / 1.15) }, '−'),
          h('button', { type: 'button', style: S.button, onClick: fitAll }, '适应'),
          h('button', { ref: fullButtonRef, type: 'button', style: S.button, onClick: () => setFullscreen(value => !value) }, fullscreen ? '退出全屏' : '全屏')),
        selectedNode ? h('div', {
          role: 'dialog',
          'aria-label': '节点详情',
          style: { position: 'absolute', top: '10px', right: '10px', width: '280px', maxHeight: 'calc(100% - 20px)', overflow: 'auto', border: C.border, borderRadius: '10px', background: C.layer, padding: '12px', boxShadow: '0 10px 24px rgba(0,0,0,.2)', userSelect: 'text', WebkitUserSelect: 'text' },
        },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' } },
          h('span', { style: { fontSize: '10px', color: fillOf(selectedNode), fontWeight: 600 } }, `${KIND_LABEL[selectedNode.kind] || selectedNode.kind} · ${selectedNode.id}`),
          h('button', { type: 'button', style: S.button, onClick: () => setSelectedId(null) }, '关闭')),
        h('div', { style: { marginTop: '6px', fontSize: '13px', fontWeight: 600, color: C.text } }, selectedNode.label || ''),
        h('div', { style: { marginTop: '4px', fontSize: '11px', color: C.muted } }, subOf(selectedNode)),
        detailFields(selectedNode).length > 0 ? h('dl', { style: { margin: '8px 0 0', display: 'grid', gridTemplateColumns: '72px 1fr', gap: '4px 8px', fontSize: '11px' } },
          detailFields(selectedNode).map(([label, value]) => h(React.Fragment, { key: label },
            h('dt', { style: { color: C.faint } }, label),
            h('dd', { style: { margin: 0, color: C.text, overflowWrap: 'anywhere' } }, value)))) : null,
        h('div', { style: { marginTop: '10px', fontSize: '11px', color: C.faint } }, '关联边'),
        selectedLinks.length > 0 ? h('div', { style: { display: 'grid', gap: '4px', marginTop: '4px', fontSize: '11px' } },
          selectedLinks.map((link, index) => h('div', { key: index, style: { color: C.muted } },
            `${link.kind}: ${link.srcId} → ${link.dstId}`))) : h('div', { style: { marginTop: '4px', fontSize: '11px', color: C.faint } }, '没有关联边。')) : null,
        links.length === 0 ? h('div', { style: { position: 'absolute', left: '12px', bottom: '12px', fontSize: '11px', color: C.faint } }, '暂无关系边：节点按初始列排布，记录攻击路径后会连起来。') : null))
    }

    function Explore({ data }) {
      const [mode, setMode] = React.useState('list')
      const intents = [...(data.intents || [])].sort((a, b) => idNum(a) - idNum(b))
      const showGraph = () => {
        setMode('graph')
        requestAnimationFrame(() => {
          const root = document.querySelector('[data-testid="lingeye-view"]')
          if (root !== null && typeof root.scrollTo === 'function') root.scrollTo({ top: 0 })
        })
      }
      const toggle = h('div', { style: { display: 'flex', gap: '4px' } },
        h('button', {
          type: 'button',
          style: mode === 'list' ? { ...S.tab, ...S.tabActive } : S.tab,
          onClick: () => setMode('list'),
        }, '列表'),
        h('button', {
          type: 'button',
          style: mode === 'graph' ? { ...S.tab, ...S.tabActive } : S.tab,
          onClick: showGraph,
        }, '图'))
      if (mode === 'graph') return card('探索链路', h(ExplorationGraph, { data }), toggle)
      if (intents.length === 0) return card('探索链路', h('p', { style: S.faint }, '（还没有意图）'), toggle)
      return card('探索链路', h('div', { style: { display: 'grid', gap: '10px' } },
        intents.map((intent) => {
          const facts = (data.facts || []).filter(fact => fact.intentId === intent.id)
          const findings = (data.findings || []).filter(finding => finding.intentId === intent.id)
          const anchors = intent.derivedFromFactIds && intent.derivedFromFactIds.length > 0
            ? 'derived from ' + intent.derivedFromFactIds.join(', ')
            : (intent.goalId ? 'spawned by ' + intent.goalId : '无锚点')
          return h('section', { key: intent.id, style: S.item },
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
        })), toggle)
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

    function Report({ data, sessionId }) {
      const [copied, setCopied] = React.useState(false)
      const projectId = data.engagement && data.engagement.projectId
      const projectTombstoned = projectId !== undefined && (data.projectTombstones || []).some(item => item.sessionId === sessionId && item.projectId === projectId)
      const markdown = typeof data.report === 'string' && projectTombstoned
        ? data.report.replace(/^- 项目：.*\n?/m, '')
        : (typeof data.report === 'string' ? data.report : '')
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

    /** Global panel icon for the project aggregation view. */
    function LingeyeProjectsIcon({ size, active }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: active ? C.brand : C.muted, strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
      h('path', { d: 'M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z' }),
      h('circle', { cx: 12, cy: 12, r: 2.6 }))
    }

    /**
     * Read-only project view: group the Lingeye projections already held by
     * the session list by `engagement.projectId`. Writes still belong to each
     * session's commander; this panel never invents a second state store.
     */
    function ProjectsPanel(props) {
      const list = props.useSessions(state => state)
      const workspaces = props.useWorkspaces ? props.useWorkspaces(state => state) : undefined
      const archived = new Set((workspaces && workspaces.archivedSessionIds) || [])
      const refreshed = React.useRef(false)
      const lingeyeIds = (list.ids || []).filter(id => {
        if (archived.has(id)) return false
        const row = list.byId && list.byId[id]
        return row !== undefined && isLingeyePreset(presetOf(row))
      })
      const refresh = () => {
        const sessions = clientCtx && clientCtx.sessions
        if (lingeyeIds.length === 0 || sessions === undefined) return
        Promise.allSettled(lingeyeIds.map(id => Promise.resolve(sessions.refreshProjections(id))))
      }
      React.useEffect(() => {
        if (refreshed.current || lingeyeIds.length === 0) return
        refreshed.current = true
        refresh()
      }, [lingeyeIds.length])
      const groups = React.useMemo(() => {
        const map = new Map()
        for (const id of lingeyeIds) {
          const state = list.projectionsBySession && list.projectionsBySession[id]
          const data = state && state.values && state.values.lingeye
          if (data === undefined || data === null || data.initialized !== true) continue
          const rawProjectId = data.engagement && data.engagement.projectId
          const tombstoned = rawProjectId !== undefined && (data.projectTombstones || [])
            .some(item => item.sessionId === id && item.projectId === rawProjectId)
          const projectId = rawProjectId && !tombstoned ? rawProjectId : id
          let group = map.get(projectId)
          if (group === undefined) {
            group = {
              id: projectId,
              standalone: projectId === id,
              target: (data.engagement && data.engagement.target) || projectId,
              objective: (data.engagement && data.engagement.objective) || '',
              sessions: [],
              latest: 0,
              intents: 0,
              facts: 0,
              assets: 0,
              findings: 0,
            }
            map.set(projectId, group)
          }
          const row = list.byId[id]
          group.sessions.push({ id, title: (row && (row.displayTitle || row.title)) || id, retained: row !== undefined && Object.values(row.retainedBy || {}).some(count => Number(count) > 0) })
          const counts = data.counts || {}
          group.intents += Number(counts.intents) || 0
          group.facts += Number(counts.facts) || 0
          group.assets += (data.assets || []).length
          group.findings += (data.findings || []).length
          const stamp = Date.parse(data.updatedAt || '')
          if (Number.isFinite(stamp)) group.latest = Math.max(group.latest, stamp)
        }
        return [...map.values()].sort((a, b) => b.latest - a.latest)
      }, [list])
      const open = (sessionId) => {
        const workspace = clientCtx && clientCtx.uiWorkspace
        if (workspace && typeof workspace.openSession === 'function') workspace.openSession(sessionId)
      }
      const archive = async (group) => {
        const target = group.sessions[0]
        const workspace = clientCtx && clientCtx.uiWorkspace
        if (target === undefined || workspace === undefined || typeof workspace.archiveSession !== 'function') return
        const confirmed = window.confirm(`归档会话「${target.title}」？\n\n归档后它会从灵眼项目面板和侧栏消失，数据不会删除，可在归档中恢复。`)
        if (!confirmed) return
        try {
          await workspace.archiveSession(target.id)
          refresh()
        } catch (error) {
          window.alert(`归档失败：${error instanceof Error ? error.message : String(error)}`)
        }
      }
      const unlink = async (group) => {
        const first = group.sessions.find(session => session.retained) || group.sessions[0]
        const sessions = clientCtx && clientCtx.sessions
        if (first === undefined || sessions === undefined) return
        if (!first.retained) {
          window.alert('这个项目当前没有活跃会话可执行清理。请先打开任一关联会话，再回来解除分组。')
          return
        }
        const confirmed = window.confirm(`解除项目「${group.id}」的分组？\n\n只清除 projectId 关联，保留所有会话、资产、证据与漏洞。\n会在第一个关联会话中发起一轮清理指令，由指挥官执行 ly_project_unlink。`)
        if (!confirmed) return
        try {
          const accepted = await sessions.using(first.id, { source: 'lingeye-projects' }, async reference => {
            return reference.binding.session.prompt([{
              type: 'text',
              text: `请只调用 ly_project_unlink，projectId="${group.id}"，解除该项目的分组，保留全部数据。完成后只回复“已解除分组”。`,
            }], 'queue')
          })
          if (accepted !== undefined && accepted.ok === false) {
            window.alert(`解除分组未发送：${accepted.error?.message || '会话拒绝了这次指令'}`)
            return
          }
          refresh()
        } catch (error) {
          window.alert(`解除分组失败：${error instanceof Error ? error.message : String(error)}`)
        }
      }
      return h('div', { style: { ...S.root, maxWidth: '1120px', margin: '0 auto' } },
        h('header', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' } },
          h('div', null,
            h('h1', { style: { margin: 0, fontSize: '20px' } }, props.t ? props.t('projects') : '灵眼项目'),
            h('p', { style: { margin: '4px 0 0', color: C.muted, fontSize: '12px' } }, `按 projectId 聚合的只读视图；仅读取 ${lingeyeIds.length} 个灵眼会话，数据仍由各会话的指挥官写入。`)),
          h('button', { type: 'button', style: S.button, onClick: refresh }, '刷新')),
        groups.length === 0
          ? h('div', { style: S.card }, h('p', { style: S.faint }, '还没有可聚合的灵眼项目。先在灵眼会话里调用 ly_start，并用 projectId 把同一项目的多个会话关联起来。'))
          : h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' } },
            groups.map(group => h('section', { key: group.id, style: S.card },
              h('div', { style: S.itemHead },
                h('span', { style: S.itemTitle }, group.target),
                h('span', { style: S.faint }, group.id)),
              group.objective ? h('p', { style: S.detail }, group.objective) : null,
              h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' } },
                badge(`${group.sessions.length} 会话`, C.muted),
                badge(`${group.intents} 意图`, C.muted),
                badge(`${group.facts} 事实`, C.muted),
                badge(`${group.findings} 漏洞`, group.findings > 0 ? C.error : C.muted),
                badge(`${group.assets} 资产`, C.muted)),
              h('div', { style: { display: 'grid', gap: '4px', marginTop: '10px' } },
                group.sessions.map(session => h('button', {
                  key: session.id, type: 'button',
                  style: { ...S.button, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                  onClick: () => open(session.id),
                }, session.title))),
              group.latest > 0 ? h('div', { style: { ...S.faint, marginTop: '8px', fontSize: '11px' } }, `最近写入：${new Date(group.latest).toLocaleString()}`) : null,
              h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '8px' } },
                group.standalone
                  ? h('button', { type: 'button', style: S.button, title: '归档会话后从项目面板移除，可在归档中恢复', onClick: () => { void archive(group) } }, '归档会话')
                  : h('button', { type: 'button', style: S.button, onClick: () => { void unlink(group) } }, '解除分组'))))
      ))
    }

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
        h('div', { style: { flex: 1, minHeight: 0 } }, h(active.view, { data, sessionId: props.sessionId })))
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

    /** Required client services for the mode gate, the tab and the project panel. */
    const inject = ['slots', 'locale', 'sessions', 'uiWorkspace']

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
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: 'lingeye-projects',
        locale: NS,
      }, ProjectsPanel))
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: 'lingeye-projects',
        order: 30,
        locale: NS,
        label: () => t('projects'),
      }, LingeyeProjectsIcon))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
