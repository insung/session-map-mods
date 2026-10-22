import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SessionEntry } from '../types'

const PANE = 'session-map'
const TOOL = 'register_session'
/** 마지막 신호가 이보다 오래된 진행 중 세션은 응답 없음으로 본다 (프로세스가 session.end 없이 끝난 경우) */
const IDLE_MS = 10 * 60 * 1000
const HEARTBEAT_MS = 60 * 1000
/** 패널은 7일, 요청 컨텍스트는 24시간 안의 세션만 보인다 */
const PANE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const CONTEXT_WINDOW_MS = 24 * 60 * 60 * 1000
const CONTEXT_LIMIT = 15

const sessions = atom({ plugin: 'session-map', key: 'sessions' } as const, [] as SessionEntry[])
const selfId = atom({ plugin: 'session-map', key: 'selfId' } as const, '')

let dir = ''
let self: SessionEntry | undefined
let heartbeat: { cancel: () => void } | undefined

/** 공유 폴더. 시험할 때는 SESSION_MAP_DIR 로 바꾼다 */
async function registryDir($: EngineInterface): Promise<string> {
  if (dir) return dir
  const custom = await $.env.get('SESSION_MAP_DIR').catch(() => undefined)
  const home = await $.env.get('HOME').catch(() => undefined)
  dir = custom || `${home}/.claude/session-map`
  return dir
}

async function readEntry($: EngineInterface, path: string): Promise<SessionEntry | undefined> {
  try {
    const text = await $.fs.read(path)
    return JSON.parse(typeof text === 'string' ? text : '') as SessionEntry
  } catch {
    return undefined
  }
}

/** 세션마다 자기 파일만 쓰므로, 두 세션이 같은 파일을 동시에 쓰지 않는다 */
async function writeSelf($: EngineInterface, patch: Partial<SessionEntry> = {}): Promise<void> {
  if (!self) return
  self = { ...self, ...patch, lastSeen: Date.now() }
  await $.fs.write(`${await registryDir($)}/${self.id}.json`, JSON.stringify(self, null, 2))
}

async function refresh($: EngineInterface): Promise<SessionEntry[]> {
  const base = await registryDir($)
  const files = await $.fs.list(base).catch(() => [])
  const now = Date.now()
  const found = await Promise.all(
    files.filter(file => file.name.endsWith('.json')).map(file => readEntry($, `${base}/${file.name}`)),
  )
  const list = found
    .filter((one): one is SessionEntry => !!one && now - one.lastSeen < PANE_WINDOW_MS)
    .sort((a, b) => a.startedAt - b.startedAt)
  await update($, sessions, () => list)
  return list
}

type Shown = 'active' | 'idle' | 'ended'

function shownStatus(one: SessionEntry, now: number): Shown {
  if (one.status === 'ended') return 'ended'
  return now - one.lastSeen > IDLE_MS ? 'idle' : 'active'
}

const STATUS_LABEL: Record<Shown, string> = { active: '진행 중', idle: '응답 없음', ended: '종료' }
const STATUS_MARK: Record<Shown, string> = { active: '●', idle: '◌', ended: '✓' }

function shortId(id: string): string {
  return id.slice(0, 8)
}

function shortPath(path: string, home: string): string {
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path
}

/** 상위가 목록에 없는 세션을 뿌리로 두고, 하위 세션을 시작 순서대로 그 아래에 단다 */
function toTree(list: SessionEntry[]): { entry: SessionEntry; depth: number }[] {
  const ids = new Set(list.map(one => one.id))
  const children = new Map<string, SessionEntry[]>()
  for (const one of list) {
    const parent = one.parentId && ids.has(one.parentId) ? one.parentId : ''
    children.set(parent, [...(children.get(parent) ?? []), one])
  }
  const rows: { entry: SessionEntry; depth: number }[] = []
  const seen = new Set<string>()
  const walk = (parent: string, depth: number) => {
    for (const one of children.get(parent) ?? []) {
      if (seen.has(one.id)) continue
      seen.add(one.id)
      rows.push({ entry: one, depth })
      walk(one.id, depth + 1)
    }
  }
  walk('', 0)
  return rows
}

function contextText(list: SessionEntry[], me: SessionEntry): string {
  const now = Date.now()
  const titleOf = (id: string) => list.find(one => one.id === id)?.title || shortId(id)
  const others = list
    .filter(one => one.id !== me.id && now - one.lastSeen < CONTEXT_WINDOW_MS)
    .slice(-CONTEXT_LIMIT)
  const lines = [
    '세션 맵 (모든 세션이 공유하는 세션 목록)',
    '',
    `이 세션: id ${me.id}, 제목 "${me.title || '(없음)'}", 목적 "${me.purpose || '(없음)'}"${me.parentId ? `, 상위 세션 ${titleOf(me.parentId)} (${me.parentId})` : ''}`,
    '',
    others.length ? '최근 24시간의 다른 세션:' : '최근 24시간에 다른 세션은 없다.',
    ...others.map(one => {
      const parent = one.parentId ? `, 상위 ${titleOf(one.parentId)}` : ''
      return `- [${STATUS_LABEL[shownStatus(one, now)]}] ${one.title || '(제목 없음)'}: ${one.purpose || '(목적 없음)'} (id ${one.id}, 폴더 ${one.cwd}${parent})`
    }),
    '',
    `규칙: 이 세션의 제목이나 목적이 비어 있거나 작업 내용이 바뀌면 ${TOOL} 도구로 적는다. 하위 세션을 시작할 때는 지시문에 "상위 세션 id: ${me.id}" 를 넣는다. 받은 지시문에 상위 세션 id 가 있으면 ${TOOL} 도구의 parentId 로 적는다.`,
  ]
  return lines.join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'session-map',
      description: '모든 세션의 제목·목적·상위·하위 관계를 보여 주는 패널을 연다',
    })
    await $.tool.register({
      name: TOOL,
      description:
        '이 세션의 제목, 목적, 상위 세션 id 를 모든 세션이 공유하는 세션 맵에 적는다. 바꿀 필드만 보낸다.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '세션 제목, 짧은 명사구' },
          purpose: { type: 'string', description: '이 세션이 처리하려는 일, 한 문장' },
          parentId: { type: 'string', description: '상위 세션 id. 지시문에 "상위 세션 id" 가 있을 때만 보낸다' },
        },
      },
      isDeferred: false,
    })

    const id = await $.session.id()
    const before = await readEntry($, `${await registryDir($)}/${id}.json`)
    const now = Date.now()
    self = {
      id,
      title: before?.title ?? '',
      purpose: before?.purpose ?? '',
      parentId: before?.parentId ?? '',
      cwd: await $.session.cwd(),
      startedAt: before?.startedAt ?? now,
      lastSeen: now,
      status: 'active',
    }
    await update($, selfId, () => id)
    await writeSelf($).catch(() => undefined)
    await refresh($).catch(() => undefined)

    heartbeat?.cancel()
    heartbeat = $.clock.every(HEARTBEAT_MS, () => {
      void writeSelf($).then(() => refresh($)).catch(() => undefined)
    })

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    heartbeat?.cancel()
    if (next.budget.remainingMs > 200) await writeSelf($, { status: 'ended' }).catch(() => undefined)
    return next(e)
  })

  // 데스크톱 앱 세션에는 prompt.compose 섹션이 실리지 않아, 목록을 요청마다 context 로 붙인다
  on('prompt.submit', async ($, e, next) => {
    if (!self) return next(e)
    await writeSelf($, { status: 'active' }).catch(() => undefined)
    const list = await refresh($).catch(() => [] as SessionEntry[])
    return next({ ...e, context: [...(e.context ?? []), contextText(list, self)] })
  })

  on('tool.call', { tool: `mcp__session-map__${TOOL}` }, async ($, e) => {
    if (!self) return { result: '세션이 아직 등록되지 않았다.' }
    const input = e as unknown as { title?: unknown; purpose?: unknown; parentId?: unknown }
    const patch: Partial<SessionEntry> = {}
    if (typeof input.title === 'string' && input.title.trim()) patch.title = input.title.trim()
    if (typeof input.purpose === 'string' && input.purpose.trim()) patch.purpose = input.purpose.trim()
    if (typeof input.parentId === 'string' && input.parentId.trim() && input.parentId.trim() !== self.id) {
      patch.parentId = input.parentId.trim()
    }
    const isSaved = await writeSelf($, patch).then(() => true, () => false)
    if (!isSaved) return { result: "세션 맵 파일을 쓰지 못했다." }
    await refresh($).catch(() => undefined)
    return { result: `세션 맵에 적었다: ${JSON.stringify({ id: self.id, ...patch })}` }
  })

  on('command.run', { command: 'session-map' }, async $ => {
    await refresh($).catch(() => undefined)
    await $.ui.open({ id: PANE, title: '세션 목록' })
    return { text: '세션 목록 패널을 열었다.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, sessions)
    const me = await read($, selfId)
    const home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
    const now = Date.now()
    const rows = toTree(list)
    const counts = list.reduce(
      (all, one) => ({ ...all, [shownStatus(one, now)]: all[shownStatus(one, now)] + 1 }),
      { active: 0, idle: 0, ended: 0 } as Record<Shown, number>,
    )
    const color: Record<Shown, string> = { active: 'green', idle: 'yellow', ended: 'gray' }

    return (
      <Box flexDirection="column">
        <Text dimColor>
          진행 중 {counts.active} · 응답 없음 {counts.idle} · 종료 {counts.ended} (최근 7일)
        </Text>
        {rows.length === 0 && <Text dimColor>등록된 세션이 없다.</Text>}
        {rows.map(({ entry, depth }) => {
          const shown = shownStatus(entry, now)
          const indent = depth ? `${'   '.repeat(depth - 1)}└─ ` : ''
          const pad = '   '.repeat(depth)
          return (
            <Box flexDirection="column" marginTop={depth ? 0 : 1}>
              <Text>
                {indent}
                <Text color={color[shown]}>{STATUS_MARK[shown]}</Text>{' '}
                <Text bold>{entry.title || '(제목 없음)'}</Text>
                {entry.id === me ? <Text color="cyan"> (이 세션)</Text> : ''}
              </Text>
              <Text dimColor>
                {pad}   {entry.purpose || '(목적 없음)'}
              </Text>
              <Text dimColor>
                {pad}   {shortId(entry.id)} · {shortPath(entry.cwd, home)} · {STATUS_LABEL[shown]}
              </Text>
            </Box>
          )
        })}
      </Box>
    )
  })
}
