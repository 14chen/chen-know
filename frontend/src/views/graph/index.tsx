/**
 * 关系图（#/graph）—— 把笔记之间的 [[双链]] 画成一张可拖拽 / 缩放 / 平移的图。
 *
 * 数据：GET /api/notes?size=200 拿节点，逐篇 GET /api/notes/{id}/links 拿出链（不新增后端接口）。
 * 布局：自写力导向（弹簧 + 斥力，O(n²) 迭代），不引 d3 / cytoscape 之类的大依赖。
 * 渲染：纯手写 SVG。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { describeApiError } from '@/api/client'
import { listLinks, listNotes } from '@/api/notes'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import { Skeleton } from '@/components/Skeleton'
import type { ViewProps } from '@/views/types'
import '@/styles/views-graph.css'

interface GraphNode {
  id: number
  title: string
  x: number
  y: number
  vx: number
  vy: number
  isolated: boolean
}

interface GraphEdge {
  s: number
  t: number
}

const MAX_TITLE = 12
const ITERATIONS = 160
const FETCH_CONCURRENCY = 6

function truncate(title: string): string {
  const text = (title || '（无标题）').trim()
  return text.length > MAX_TITLE ? text.slice(0, MAX_TITLE) + '…' : text
}

/** 自写力导向布局：斥力 O(n²) + 边的弹簧力，迭代后按包围盒归一化 */
function layout(ids: number[], titles: Map<number, string>, edges: GraphEdge[]): GraphNode[] {
  const n = ids.length
  const nodes: GraphNode[] = ids.map((id, index) => {
    const angle = (index / Math.max(1, n)) * Math.PI * 2
    const radius = 120 + (index % 7) * 26
    return {
      id,
      title: titles.get(id) ?? String(id),
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      isolated: true,
    }
  })
  const index = new Map(nodes.map((node, i) => [node.id, i]))
  const links = edges
    .map((edge) => ({ a: index.get(edge.s), b: index.get(edge.t) }))
    .filter((edge): edge is { a: number; b: number } => edge.a !== undefined && edge.b !== undefined && edge.a !== edge.b)
  for (const link of links) {
    nodes[link.a].isolated = false
    nodes[link.b].isolated = false
  }

  if (n > 1) {
    const repulsion = 5200
    const springLength = 110
    const springStrength = 0.02
    for (let iter = 0; iter < ITERATIONS; iter += 1) {
      const cooling = 1 - iter / ITERATIONS
      // 斥力（所有对）
      for (let i = 0; i < n; i += 1) {
        const a = nodes[i]
        for (let j = i + 1; j < n; j += 1) {
          const b = nodes[j]
          let dx = a.x - b.x
          let dy = a.y - b.y
          let dist2 = dx * dx + dy * dy
          if (dist2 < 1) {
            dx = (i % 2 === 0 ? 1 : -1) * 0.5
            dy = (j % 2 === 0 ? 1 : -1) * 0.5
            dist2 = 0.5
          }
          const dist = Math.sqrt(dist2)
          const force = repulsion / dist2
          const fx = (dx / dist) * force
          const fy = (dy / dist) * force
          a.vx += fx * cooling
          a.vy += fy * cooling
          b.vx -= fx * cooling
          b.vy -= fy * cooling
        }
      }
      // 边的弹簧力
      for (const link of links) {
        const a = nodes[link.a]
        const b = nodes[link.b]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const force = (dist - springLength) * springStrength
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }
      // 向心收敛 + 阻尼
      for (const node of nodes) {
        node.vx -= node.x * 0.0012
        node.vy -= node.y * 0.0012
        node.vx *= 0.82
        node.vy *= 0.82
        node.x += node.vx
        node.y += node.vy
      }
    }
  }

  // 孤立节点排到外圈，避免压在中间
  const linked = nodes.filter((node) => !node.isolated)
  const orphans = nodes.filter((node) => node.isolated)
  if (orphans.length > 0) {
    const maxR = linked.reduce((acc, node) => Math.max(acc, Math.hypot(node.x, node.y)), 140)
    const ring = maxR + 90
    orphans.forEach((node, i) => {
      const angle = (i / orphans.length) * Math.PI * 2 - Math.PI / 2
      node.x = Math.cos(angle) * ring
      node.y = Math.sin(angle) * ring
    })
  }
  return nodes
}

export default function GraphView({ ctx }: ViewProps) {
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [hover, setHover] = useState<number | null>(null)
  const [view, setView] = useState({ k: 1, x: 0, y: 0 })
  const [size, setSize] = useState({ w: 800, h: 600 })
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<{ node: number | null; panX: number; panY: number; moved: boolean } | null>(null)
  /** 本次按下是否发生过拖动：拖动结束时不当作点击 */
  const dragMovedRef = useRef(false)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setStatus('loading')
    setError('')
    setProgress({ done: 0, total: 0 })
    try {
      const page = await listNotes({ size: 200, signal: controller.signal })
      const items = page.items ?? []
      if (controller.signal.aborted) return
      const titles = new Map(items.map((item) => [item.id, item.title]))
      setProgress({ done: 0, total: items.length })

      // 并发拉出链（同一个 note 只算一次）；单篇失败不影响整体
      const queue = [...items]
      const seen = new Set<string>()
      const collected: GraphEdge[] = []
      let done = 0
      const workers = Array.from({ length: FETCH_CONCURRENCY }, async () => {
        for (;;) {
          const note = queue.shift()
          if (!note || controller.signal.aborted) return
          try {
            const linkView = await listLinks(note.id, controller.signal)
            for (const link of linkView.resolved) {
              if (!titles.has(link.noteId) || link.noteId === note.id) continue
              const key = note.id + '>' + link.noteId
              if (seen.has(key)) continue
              seen.add(key)
              collected.push({ s: note.id, t: link.noteId })
            }
          } catch {
            /* 忽略单篇失败 */
          }
          done += 1
          if (!controller.signal.aborted) setProgress({ done, total: items.length })
        }
      })
      await Promise.all(workers)
      if (controller.signal.aborted) return

      setEdges(collected)
      setNodes(layout(items.map((item) => item.id), titles, collected))
      setStatus('ready')
    } catch (err) {
      if (controller.signal.aborted) return
      setError(describeApiError(err))
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void load()
    return () => {
      abortRef.current?.abort()
    }
  }, [load])

  // 容器尺寸变化（含手机旋转）时重新适配视野
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const apply = () => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) setSize({ w: Math.round(rect.width), h: Math.round(rect.height) })
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const bounds = useMemo(() => {
    if (nodes.length === 0) return { minX: -200, minY: -200, width: 400, height: 400 }
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const node of nodes) {
      minX = Math.min(minX, node.x)
      minY = Math.min(minY, node.y)
      maxX = Math.max(maxX, node.x)
      maxY = Math.max(maxY, node.y)
    }
    const pad = 140
    return {
      minX: minX - pad,
      minY: minY - pad,
      width: Math.max(320, maxX - minX + pad * 2),
      height: Math.max(240, maxY - minY + pad * 2),
    }
  }, [nodes])

  /** 把整张图缩放平移到容器里（留 8% 边距） */
  const fitView = useCallback(() => {
    if (nodes.length === 0) return
    const k = Math.min(size.w / bounds.width, size.h / bounds.height) * 0.92
    const kk = Math.max(0.18, Math.min(2.5, k))
    // 内层 <g> 已经把内容平移到 (0,0) 起，这里只需居中，别再减 minX（会双重偏移）
    setView({
      k: kk,
      x: (size.w - bounds.width * kk) / 2,
      y: (size.h - bounds.height * kk) / 2,
    })
  }, [bounds, nodes.length, size.h, size.w])

  useEffect(() => {
    if (status === 'ready' && nodes.length > 0) fitView()
    // 只在「节点数量变化 / 容器尺寸变化」时重排视野，拖动节点不重置
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, nodes.length, size.w, size.h])

  const neighbourIds = useMemo(() => {
    if (hover === null) return null
    const set = new Set<number>([hover])
    for (const edge of edges) {
      if (edge.s === hover) set.add(edge.t)
      if (edge.t === hover) set.add(edge.s)
    }
    return set
  }, [hover, edges])

  const zoomAt = useCallback((factor: number, clientX?: number, clientY?: number) => {
    setView((prev) => {
      const k = Math.min(4, Math.max(0.2, prev.k * factor))
      if (!svgRef.current) return { ...prev, k }
      const rect = svgRef.current.getBoundingClientRect()
      const px = (clientX ?? rect.left + rect.width / 2) - rect.left
      const py = (clientY ?? rect.top + rect.height / 2) - rect.top
      // 保持指针下的图坐标不动
      const gx = (px - prev.x) / prev.k
      const gy = (py - prev.y) / prev.k
      return { k, x: px - gx * k, y: py - gy * k }
    })
  }, [])

  const onWheel = useCallback(
    (event: React.WheelEvent<SVGSVGElement>) => {
      event.preventDefault()
      zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX, event.clientY)
    },
    [zoomAt],
  )

  const toGraphPoint = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      return { x: (clientX - rect.left - view.x) / view.k, y: (clientY - rect.top - view.y) / view.k }
    },
    [view],
  )

  const onPointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const target = (event.target as Element).closest('[data-node-id]')
      const nodeId = target ? Number(target.getAttribute('data-node-id')) : null
      dragRef.current = { node: nodeId, panX: event.clientX, panY: event.clientY, moved: false }
      dragMovedRef.current = false
      // 只给「拖背景平移」做指针捕获：捕获会把 click 重定向到 <svg>，
      // 节点自己的 click 就收不到了（实测踩过）。
      if (nodeId === null) {
        try {
          ;(event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId)
        } catch {
          /* 合成事件上可能不支持捕获，忽略 */
        }
      }
    },
    [],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current
      if (!drag) return
      const dx = event.clientX - drag.panX
      const dy = event.clientY - drag.panY
      if (Math.abs(dx) + Math.abs(dy) > 3) {
        drag.moved = true
        dragMovedRef.current = true
      }
      if (drag.node === null) {
        setView((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }))
        drag.panX = event.clientX
        drag.panY = event.clientY
        return
      }
      const point = toGraphPoint(event.clientX, event.clientY)
      setNodes((prev) => prev.map((node) => (node.id === drag.node ? { ...node, x: point.x, y: point.y } : node)))
    },
    [toGraphPoint],
  )

  const onPointerUp = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    dragRef.current = null
    try {
      ;(event.currentTarget as SVGSVGElement).releasePointerCapture(event.pointerId)
    } catch {
      /* ignore */
    }
    // 真正的「点节点打开笔记」交给节点自己的 onClick（配合 dragMovedRef 抑制拖拽误触）
  }, [])

  const resetView = useCallback(() => fitView(), [fitView])

  return (
    <div className="vw-graph">
      <header className="vw-graph__head">
        <div className="vw-graph__heading">
          <h1 className="vw-graph__title">关系图</h1>
          <p className="vw-graph__sub">
            {status === 'ready'
              ? nodes.length + ' 篇笔记 · ' + edges.length + ' 条引用 · 拖动节点，滚轮缩放，点节点打开'
              : '笔记之间 [[双链]] 的关系图'}
          </p>
        </div>
        <div className="vw-graph__actions">
          <Button size="sm" onClick={() => zoomAt(1.2)} aria-label="放大">
            放大
          </Button>
          <Button size="sm" onClick={() => zoomAt(1 / 1.2)} aria-label="缩小">
            缩小
          </Button>
          <Button size="sm" onClick={resetView}>
            复位
          </Button>
          <Button size="sm" onClick={() => void load()} disabled={status === 'loading'}>
            刷新
          </Button>
        </div>
      </header>

      <div className="vw-graph__body" ref={wrapRef}>
        {status === 'loading' ? (
          <div className="vw-graph__state">
            <Skeleton width={200} height={16} />
            <p className="vw-graph__faint">
              正在读取引用关系{progress.total > 0 ? '（' + progress.done + '/' + progress.total + '）' : '…'}
            </p>
          </div>
        ) : null}

        {status === 'error' ? (
          <div className="vw-graph__state">
            <EmptyState
              title="加载失败"
              desc={error || '无法读取笔记与引用'}
              action={
                <Button variant="primary" onClick={() => void load()}>
                  重试
                </Button>
              }
            />
          </div>
        ) : null}

        {status === 'ready' && nodes.length === 0 ? (
          <div className="vw-graph__state">
            <EmptyState
              title="还没有笔记"
              desc="先建一篇笔记，再到正文里输入 [[ 引用另一篇，关系图就会长出来。"
              action={
                <Button variant="primary" onClick={() => ctx.navigate('notes')}>
                  去写第一篇
                </Button>
              }
            />
          </div>
        ) : null}

        {status === 'ready' && nodes.length > 0 ? (
          <>
            {edges.length === 0 ? (
              <p className="vw-graph__hint">
                还没有任何双链。在笔记正文里输入 <code>[[</code> 选择另一篇笔记，这里就会出现连线。
              </p>
            ) : null}
            <svg
              ref={svgRef}
              className="vw-graph__svg"
              viewBox={'0 0 ' + size.w + ' ' + size.h}
              role="img"
              aria-label={'笔记关系图，共 ' + nodes.length + ' 个节点'}
              onWheel={onWheel}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <g transform={'translate(' + view.x + ' ' + view.y + ') scale(' + view.k + ')'}>
                <g transform={'translate(' + -bounds.minX + ' ' + -bounds.minY + ')'}>
                  {edges.map((edge) => {
                    const from = nodes.find((node) => node.id === edge.s)
                    const to = nodes.find((node) => node.id === edge.t)
                    if (!from || !to) return null
                    const active =
                      hover === null
                        ? false
                        : edge.s === hover || edge.t === hover
                    return (
                      <line
                        key={edge.s + '-' + edge.t}
                        className={'vw-graph__edge' + (active ? ' is-active' : '') + (hover !== null && !active ? ' is-dim' : '')}
                        x1={from.x}
                        y1={from.y}
                        x2={to.x}
                        y2={to.y}
                      />
                    )
                  })}
                  {nodes.map((node) => {
                    const dim = neighbourIds !== null && !neighbourIds.has(node.id)
                    return (
                      <g
                        key={node.id}
                        data-node-id={node.id}
                        className={'vw-graph__node' + (hover === node.id ? ' is-hover' : '') + (dim ? ' is-dim' : '')}
                        transform={'translate(' + node.x + ' ' + node.y + ')'}
                        onPointerEnter={() => setHover(node.id)}
                        onPointerLeave={() => setHover((current) => (current === node.id ? null : current))}
                        onClick={() => {
                          if (dragMovedRef.current) return
                          ctx.openNote(node.id)
                        }}
                      >
                        {/* 圆点/文字按 1/k 反缩放：不管放大缩小，屏幕上的可读性都一致 */}
                        <circle className="vw-graph__hit" r={18 / view.k} />
                        <circle
                          className={'vw-graph__dot' + (node.isolated ? ' is-isolated' : '')}
                          r={(node.isolated ? 5 : 7) / view.k}
                        />
                        <text className="vw-graph__label" x={11 / view.k} y={4 / view.k} fontSize={11 / view.k}>
                          {truncate(node.title)}
                        </text>
                        <title>{node.title + (node.isolated ? '（暂无链接）' : '')}</title>
                      </g>
                    )
                  })}
                </g>
              </g>
            </svg>
          </>
        ) : null}
      </div>
    </div>
  )
}
