import type { FlowNode, HostGroup, HostSession, NodeStatus, Ref, SessionEntry } from '../types'
import { mergeRefs, refLabel, refsOfTitle } from './refs'

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

function hostPr(host: HostSession): Ref[] {
  if (!host.prNumber) return []
  const state = host.prState === 'MERGED' ? 'merged' : host.prState === 'CLOSED' ? 'closed' : 'open'
  return [{ kind: 'pr', repo: '', number: host.prNumber, state }]
}

/** 기록의 이슈·PR 과 제목의 이슈 번호를 합친다. 저장소를 아는 기록이 있으면 같은 번호의 저장소 모르는 항목은 뺀다 */
function sessionRefs(recorded: readonly Ref[], extra: readonly Ref[]): Ref[] {
  const known = new Set(recorded.map(one => `${one.kind}#${one.number}`))
  return mergeRefs(recorded, extra.filter(one => !known.has(`${one.kind}#${one.number}`)))
}

/**
 * 데스크톱 세션 목록과 공유 폴더 기록을 세션 하나씩으로 합친다.
 * 데스크톱 세션은 사이드바 그룹이 섹션이고, 기록에서 목적·지금 상태·이슈·PR 을 가져온다.
 * 데스크톱에 없는 기록(터미널 세션)은 작업 폴더 이름을 섹션으로 쓴다.
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
      cwd: host.cwd,
      refs: sessionRefs(entry?.refs ?? [], [...refsOfTitle(host.title), ...hostPr(host)]),
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
      cwd: entry.cwd,
      refs: sessionRefs(entry.refs, refsOfTitle(entry.title)),
      startedAt: entry.startedAt,
    })
  }
  return nodes
}

export type SectionSummary = { name: string; total: number; running: number; lastAt: number }

/** 섹션 목록. 데스크톱 사이드바와 같은 순서이고, 사이드바에 없는 섹션(그룹 없음, 터미널 폴더)은 뒤에 둔다 */
export function sections(nodes: FlowNode[], groups: HostGroup[]): SectionSummary[] {
  const map = new Map<string, SectionSummary>()
  for (const one of nodes) {
    const row = map.get(one.project) ?? { name: one.project, total: 0, running: 0, lastAt: 0 }
    row.total += 1
    if (one.status === 'running') row.running += 1
    row.lastAt = Math.max(row.lastAt, one.startedAt)
    map.set(one.project, row)
  }
  const order = new Map(groups.map(group => [group.name, group.order]))
  const rank = (row: SectionSummary) => order.get(row.name) ?? Number.MAX_SAFE_INTEGER
  return [...map.values()].sort((a, b) => rank(a) - rank(b) || b.lastAt - a.lastAt)
}

export type Task = {
  id: string
  title: string
  keys: string[]
  sections: string[]
  total: number
  running: number
  done: number
  refs: Ref[]
  lastAt: number
}

/** 작업 이름은 첫 세션의 제목에서 `[완료]`, `#12` 같은 앞머리를 뺀 것이다 */
function taskTitle(title: string): string {
  return title.replace(/^\s*\[[^\]]*\]\s*/, '').replace(/^\s*(issue\s*)?#\d+\s*/i, '').trim() || title
}

/**
 * 세션을 큰 단위 작업으로 묶는다. 다음 중 하나라도 맞으면 같은 작업이다.
 * - 한 세션이 다른 세션을 시작했다 (섹션이 달라도)
 * - 곁가지로 이어 두었다
 * - 같은 저장소의 같은 이슈·PR 을 다뤘다 (제목에서만 읽은 번호는 같은 섹션·같은 폴더일 때만)
 */
export function tasks(nodes: FlowNode[]): Task[] {
  const parent = new Map(nodes.map(one => [one.key, one.key]))
  const find = (key: string): string => {
    let root = key
    while (parent.get(root) !== root) root = parent.get(root)!
    parent.set(key, root)
    return root
  }
  const join = (a: string, b: string) => {
    if (!parent.has(a) || !parent.has(b)) return
    parent.set(find(a), find(b))
  }
  const byRef = new Map<string, string>()
  for (const one of nodes) {
    if (one.parentKey) join(one.key, one.parentKey)
    for (const related of one.relatedKeys) join(one.key, related)
    for (const ref of one.refs) {
      const where = ref.repo || `${one.project}|${one.cwd}`
      const key = `${where}#${ref.number}`
      const seen = byRef.get(key)
      if (seen) join(one.key, seen)
      else byRef.set(key, one.key)
    }
  }

  const groups = new Map<string, FlowNode[]>()
  for (const one of nodes) groups.set(find(one.key), [...(groups.get(find(one.key)) ?? []), one])
  return [...groups.values()]
    .map(list => {
      const sorted = [...list].sort((a, b) => a.startedAt - b.startedAt)
      const keys = new Set(sorted.map(one => one.key))
      const first = sorted.find(one => !keys.has(one.parentKey)) ?? sorted[0]!
      return {
        id: first.key,
        title: taskTitle(first.title),
        keys: sorted.map(one => one.key),
        sections: [...new Set(sorted.map(one => one.project))],
        total: sorted.length,
        running: sorted.filter(one => one.status === 'running').length,
        done: sorted.filter(one => one.status === 'done').length,
        refs: sorted.reduce<Ref[]>((all, one) => mergeRefs(all, one.refs), []),
        lastAt: Math.max(...sorted.map(one => one.startedAt)),
      }
    })
    .sort((a, b) => b.running - a.running || b.lastAt - a.lastAt)
}

/** 플로우의 칸 하나. external 이면 보고 있는 범위 밖(다른 섹션·다른 작업)의 세션이다 */
export type Placed = { node: FlowNode; col: number; row: number; external: boolean }
export type Edge = { from: string; to: string; kind: 'started' | 'related' }
export type Flow = { placed: Placed[]; edges: Edge[]; cols: number; rows: number }

/**
 * 범위 안 세션들의 플로우를 칸에 놓는다. 범위는 섹션 이름이나 작업의 세션 key 들이다.
 * 시작한 세션이 왼쪽, 그 세션이 시작한 세션이 오른쪽 칸이다. 범위 밖과 이어진 세션은 그 옆 칸에 external 로 놓는다.
 * 아무 세션도 시작하지 않은 세션은 시작 순서대로 아래 줄에 놓는다.
 */
export function layoutFlow(nodes: FlowNode[], scope: string | readonly string[]): Flow {
  const byKey = new Map(nodes.map(one => [one.key, one]))
  const scopeKeys = typeof scope === 'string' ? nodes.filter(one => one.project === scope).map(one => one.key) : scope
  const insideKeys = new Set(scopeKeys)
  const inside = nodes.filter(one => insideKeys.has(one.key)).sort((a, b) => a.startedAt - b.startedAt)
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
    // 상위가 범위 안에 있으면 그 상위를 따라 그릴 때 함께 놓인다
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

  // 곁가지로 이어 둔 세션: 범위 안 세션과 이어진 세션을 그 오른쪽에 놓는다
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

const NODE_W = 228
const NODE_H = 98
const GAP_X = 56
const GAP_Y = 18
const PAD = 12
const CHIP_H = 16

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

const CHIP_COLOR: Record<string, { fill: string; text: string }> = {
  issue: { fill: '#e7f5ff', text: '#1971c2' },
  pr: { fill: '#f3f0ff', text: '#6741d9' },
  merged: { fill: '#f3f0ff', text: '#5f3dc4' },
  closed: { fill: '#f1f3f5', text: '#868e96' },
}

/** 이슈·PR 을 칸 아래쪽에 알약 모양으로 놓는다. 다 들어가지 않으면 `+N` 으로 줄인다 */
export function chipsSvg(refs: readonly Ref[], x: number, y: number, width: number): string {
  const size = 10
  const parts: string[] = []
  let used = 0
  for (const [index, ref] of refs.entries()) {
    const label = refLabel(ref)
    const w = textWidth(label, size) + 12
    const rest = refs.length - index - 1
    const room = rest ? width - textWidth(`+${rest}`, size) - 12 : width
    if (used + w > room) {
      parts.push(`<text x="${x + used + 2}" y="${y + 12}" font-size="${size}" fill="#868e96">+${refs.length - index}</text>`)
      break
    }
    const color = CHIP_COLOR[ref.state === 'merged' ? 'merged' : ref.state === 'closed' ? 'closed' : ref.kind]!
    parts.push(
      `<rect x="${x + used}" y="${y}" width="${w}" height="${CHIP_H}" rx="8" fill="${color.fill}"/>`,
      `<text x="${x + used + 6}" y="${y + 12}" font-size="${size}" fill="${color.text}">${escape(label)}</text>`,
    )
    used += w + 4
  }
  return parts.join('')
}

/**
 * 플로우를 SVG 로 그린다. 시작 관계는 실선 화살표, 곁가지 관계와 범위 밖 세션은 점선이다.
 * withSection 이면 칸마다 섹션 이름을 적는다 (작업 탭처럼 여러 섹션이 섞일 때).
 */
export function flowSvg(flow: Flow, selfKey: string, withSection = false): string {
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
      const desc = node.now || node.purpose || STATUS_LABEL[node.status]
      const sub = external || withSection ? `${external ? '↗ ' : ''}${node.project} · ${desc}` : desc
      return [
        `<g><title>${escape(`${node.title}\n${node.project}\n${node.purpose}\n${node.now}`)}</title>`,
        `<rect x="${p.x}" y="${p.y}" width="${NODE_W}" height="${NODE_H}" rx="8" fill="${external ? '#f8f9fa' : '#ffffff'}" stroke="${border}" stroke-width="${node.key === selfKey ? 2 : 1}"${dash}/>`,
        `<circle cx="${p.x + 14}" cy="${p.y + 19}" r="5" fill="${color}"/>`,
        `<text x="${p.x + 26}" y="${p.y + 23}" font-size="13" font-weight="600" fill="#212529">${escape(fitLines(node.title, 13, NODE_W - 36, 1)[0] ?? '')}</text>`,
        ...fitLines(sub, 11, NODE_W - 24, 2).map(
          (line, i) => `<text x="${p.x + 12}" y="${p.y + 44 + i * 15}" font-size="11" fill="#495057">${escape(line)}</text>`,
        ),
        chipsSvg(node.refs, p.x + 12, p.y + NODE_H - CHIP_H - 10, NODE_W - 24),
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
