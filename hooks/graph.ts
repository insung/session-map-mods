import type { FlowNode, HostSession, NodeStatus, SessionEntry } from '../types'

/** 마지막 신호가 이보다 오래된 진행 중 세션은 응답 없음으로 본다 (프로세스가 session.end 없이 끝난 경우) */
export const IDLE_MS = 10 * 60 * 1000
export const NO_PROJECT = '그룹 없음'

export const STATUS_LABEL: Record<NodeStatus, string> = { running: '진행 중', waiting: '대기', idle: '응답 없음', done: '완료' }
export const STATUS_MARK: Record<NodeStatus, string> = { running: '●', waiting: '○', idle: '◌', done: '✓' }
export const STATUS_COLOR: Record<NodeStatus, string> = { running: '#2f9e44', waiting: '#868e96', idle: '#e8590c', done: '#1c7ed6' }

function folderName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

function hostStatus(one: HostSession): NodeStatus {
  if (one.isRunning) return 'running'
  if (one.prState === 'MERGED' || one.title.startsWith('[완료]')) return 'done'
  return 'waiting'
}

function entryStatus(one: SessionEntry, now: number): NodeStatus {
  if (one.status === 'ended') return 'done'
  return now - one.lastSeen > IDLE_MS ? 'idle' : 'running'
}

/**
 * 데스크톱 세션 목록과 공유 폴더 기록을 세션 하나씩으로 합친다.
 * 데스크톱 세션은 사이드바 그룹이 프로젝트이고, 기록에서 목적과 지금 상태를 가져온다.
 * 데스크톱에 없는 기록(터미널 세션)은 작업 폴더 이름을 프로젝트로 쓴다.
 */
export function toNodes(entries: SessionEntry[], hosts: HostSession[], now: number): FlowNode[] {
  const byHost = new Map(entries.filter(one => one.hostId).map(one => [one.hostId, one]))
  const byId = new Map(entries.map(one => [one.id, one]))
  // 기록은 상위·관련 세션을 CLI 세션 id 로 적을 수도 있어, 데스크톱 세션이 있으면 그 id 로 바꾼다
  const keyOf = (id: string) => byId.get(id)?.hostId || id
  const nodes: FlowNode[] = hosts.map(host => {
    const entry = byHost.get(host.sessionId)
    return {
      key: host.sessionId,
      title: host.title || entry?.title || '(제목 없음)',
      project: host.group?.name || NO_PROJECT,
      parentKey: host.startedBy || (entry?.parentId ? keyOf(entry.parentId) : ''),
      relatedKeys: (entry?.relatedIds ?? []).map(keyOf),
      status: hostStatus(host),
      purpose: entry?.purpose ?? '',
      now: entry?.now ?? '',
      link: host.link ?? '',
      pr: host.prNumber ? `PR #${host.prNumber}${host.prState === 'MERGED' ? ' 머지' : ''}` : '',
      startedAt: entry?.startedAt ?? (Date.parse(host.lastActivityAt) || 0),
    }
  })
  const shown = new Set(nodes.map(one => one.key))
  for (const entry of entries) {
    if (entry.hostId && (shown.has(entry.hostId) || hosts.length)) continue
    nodes.push({
      key: entry.hostId || entry.id,
      title: entry.title || '(제목 없음)',
      project: folderName(entry.cwd),
      parentKey: entry.parentId ? keyOf(entry.parentId) : '',
      relatedKeys: entry.relatedIds.map(keyOf),
      status: entryStatus(entry, now),
      purpose: entry.purpose,
      now: entry.now,
      link: entry.hostId ? `claude://claude.ai/epitaxy/${entry.hostId}` : '',
      pr: '',
      startedAt: entry.startedAt,
    })
  }
  return nodes
}

export type ProjectSummary = { name: string; total: number; running: number; lastAt: number }

export function projects(nodes: FlowNode[]): ProjectSummary[] {
  const map = new Map<string, ProjectSummary>()
  for (const one of nodes) {
    const row = map.get(one.project) ?? { name: one.project, total: 0, running: 0, lastAt: 0 }
    row.total += 1
    if (one.status === 'running') row.running += 1
    row.lastAt = Math.max(row.lastAt, one.startedAt)
    map.set(one.project, row)
  }
  return [...map.values()].sort((a, b) => b.running - a.running || b.lastAt - a.lastAt)
}

/** 플로우의 칸 하나. external 이면 다른 프로젝트의 세션이다 */
export type Placed = { node: FlowNode; col: number; row: number; external: boolean }
export type Edge = { from: string; to: string; kind: 'started' | 'related' }
export type Flow = { placed: Placed[]; edges: Edge[]; cols: number; rows: number }

/**
 * 한 프로젝트의 플로우를 칸에 놓는다.
 * 시작한 세션이 왼쪽, 그 세션이 시작한 세션이 오른쪽 칸이다. 다른 프로젝트와 이어진 세션은 그 옆 칸에 external 로 놓는다.
 * 아무 세션도 시작하지 않은 세션은 시작 순서대로 아래 줄에 놓는다.
 */
export function layoutFlow(nodes: FlowNode[], project: string): Flow {
  const byKey = new Map(nodes.map(one => [one.key, one]))
  const inside = nodes.filter(one => one.project === project).sort((a, b) => a.startedAt - b.startedAt)
  const insideKeys = new Set(inside.map(one => one.key))
  const children = new Map<string, FlowNode[]>()
  for (const one of nodes) {
    if (!one.parentKey) continue
    children.set(one.parentKey, [...(children.get(one.parentKey) ?? []), one])
  }

  const placed: Placed[] = []
  const edges: Edge[] = []
  const at = new Set<string>()
  let row = 0
  const put = (node: FlowNode, col: number, external: boolean) => {
    placed.push({ node, col, row, external })
    at.add(node.key)
  }
  const walk = (node: FlowNode, col: number) => {
    put(node, col, false)
    let isFirst = true
    for (const child of (children.get(node.key) ?? []).sort((a, b) => a.startedAt - b.startedAt)) {
      edges.push({ from: node.key, to: child.key, kind: 'started' })
      if (at.has(child.key)) continue
      if (!isFirst) row += 1
      isFirst = false
      if (insideKeys.has(child.key)) walk(child, col + 1)
      else put(child, col + 1, true)
    }
  }

  for (const node of inside) {
    if (at.has(node.key)) continue
    const parent = byKey.get(node.parentKey)
    // 상위가 이 프로젝트 안에 있으면 그 상위를 따라 그릴 때 함께 놓인다
    if (parent && insideKeys.has(parent.key)) continue
    if (parent) {
      put(parent, 0, true)
      edges.push({ from: parent.key, to: node.key, kind: 'started' })
      walk(node, 1)
    } else {
      walk(node, 0)
    }
    row += 1
  }

  // 곁가지로 이어 둔 세션: 이 프로젝트 세션과 이어진 다른 프로젝트 세션을 그 오른쪽에 놓는다
  for (const one of nodes) {
    for (const related of one.relatedKeys) {
      const [mine, other] = insideKeys.has(one.key) ? [one.key, related] : insideKeys.has(related) ? [related, one.key] : ['', '']
      if (!mine || !byKey.get(other)) continue
      edges.push({ from: mine, to: other, kind: 'related' })
      if (at.has(other)) continue
      const base = placed.find(p => p.node.key === mine)
      placed.push({ node: byKey.get(other)!, col: (base?.col ?? 0) + 1, row, external: !insideKeys.has(other) })
      at.add(other)
      row += 1
    }
  }

  const cols = Math.max(1, ...placed.map(p => p.col + 1))
  return { placed, edges, cols, rows: Math.max(1, row) }
}

const NODE_W = 220
const NODE_H = 74
const GAP_X = 56
const GAP_Y = 18
const PAD = 12

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 글자 폭 어림값. 한글·한자 같은 넓은 글자는 글자 크기만큼, 나머지는 그 0.6배로 본다 */
function charWidth(char: string, size: number): number {
  return /[ᄀ-ᇿ⺀-꓏가-힯豈-﫿＀-￯]/.test(char) ? size : size * 0.6
}

function textWidth(text: string, size: number): number {
  return [...text].reduce((sum, char) => sum + charWidth(char, size), 0)
}

/** 글자를 칸 폭에 맞춰 최대 maxLines 줄로 나눈다. 넘치면 마지막 줄 끝을 …로 줄인다 */
export function fitLines(text: string, size: number, width: number, maxLines: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const char of text.replace(/\s+/g, ' ').trim()) {
    if (line && textWidth(line + char, size) > width) {
      lines.push(line.trimEnd())
      line = char === ' ' ? '' : char
    } else {
      line += char
    }
  }
  if (line) lines.push(line)
  if (lines.length <= maxLines) return lines
  let last = lines[maxLines - 1]
  while (last && textWidth(`${last}…`, size) > width) last = last.slice(0, -1)
  return [...lines.slice(0, maxLines - 1), `${last.trimEnd()}…`]
}

/** 플로우를 SVG 로 그린다. 시작 관계는 실선 화살표, 곁가지 관계와 다른 프로젝트 세션은 점선이다 */
export function flowSvg(flow: Flow, selfKey: string): string {
  const width = PAD * 2 + flow.cols * NODE_W + (flow.cols - 1) * GAP_X
  const height = PAD * 2 + flow.rows * NODE_H + (flow.rows - 1) * GAP_Y
  const pos = new Map(flow.placed.map(p => [p.node.key, { x: PAD + p.col * (NODE_W + GAP_X), y: PAD + p.row * (NODE_H + GAP_Y) }]))

  const edges = flow.edges
    .map(edge => {
      const a = pos.get(edge.from)
      const b = pos.get(edge.to)
      if (!a || !b) return ''
      const x1 = a.x + NODE_W
      const y1 = a.y + NODE_H / 2
      const x2 = b.x
      const y2 = b.y + NODE_H / 2
      const mid = (x1 + x2) / 2
      const dash = edge.kind === 'related' ? ' stroke-dasharray="5 4"' : ''
      return `<path d="M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2 - 2},${y2}" fill="none" stroke="#868e96" stroke-width="1.5"${dash} marker-end="url(#arrow)"/>`
    })
    .join('')

  const boxes = flow.placed
    .map(({ node, external }) => {
      const p = pos.get(node.key)!
      const color = STATUS_COLOR[node.status]
      const border = node.key === selfKey ? '#7048e8' : external ? '#adb5bd' : '#ced4da'
      const dash = external ? ' stroke-dasharray="5 4"' : ''
      const sub = external ? `↗ ${node.project}` : node.now || node.purpose || STATUS_LABEL[node.status]
      return [
        `<g><title>${escape(`${node.title}\n${node.purpose}\n${node.now}`)}</title>`,
        `<rect x="${p.x}" y="${p.y}" width="${NODE_W}" height="${NODE_H}" rx="8" fill="${external ? '#f8f9fa' : '#ffffff'}" stroke="${border}" stroke-width="${node.key === selfKey ? 2 : 1}"${dash}/>`,
        `<circle cx="${p.x + 14}" cy="${p.y + 19}" r="5" fill="${color}"/>`,
        `<text x="${p.x + 26}" y="${p.y + 23}" font-size="13" font-weight="600" fill="#212529">${escape(fitLines(node.title, 13, NODE_W - 36, 1)[0] ?? '')}</text>`,
        ...fitLines(sub, 11, NODE_W - 24, 2).map(
          (line, i) => `<text x="${p.x + 12}" y="${p.y + 46 + i * 15}" font-size="11" fill="#495057">${escape(line)}</text>`,
        ),
        `</g>`,
      ].join('')
    })
    .join('')

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="-apple-system, sans-serif">`,
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#868e96"/></marker></defs>`,
    edges,
    boxes,
    `</svg>`,
  ].join('')
}
