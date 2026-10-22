import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FlowNode, HostGroup, HostSession, PaneTab, SessionEntry } from '../types'
import { STATUS_LABEL, STATUS_MARK, flowSvg, layoutFlow, sections, tasks, toNodes } from './graph'
import { mergeRefs, refLabel, refsOfGhCommand, repoOfRemote } from './refs'

const PANE = 'session-map'
const TOOL = 'register_session'
const HEARTBEAT_MS = 60 * 1000
/** 패널은 7일, 요청 컨텍스트는 24시간 안의 세션만 보인다 */
const PANE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const CONTEXT_WINDOW_MS = 24 * 60 * 60 * 1000
const CONTEXT_LIMIT = 15
const HOST_LIMIT = 200

const sessions = atom({ plugin: 'session-map', key: 'sessions' } as const, [] as SessionEntry[])
const hostSessions = atom({ plugin: 'session-map', key: 'hostSessions' } as const, [] as HostSession[])
const selfId = atom({ plugin: 'session-map', key: 'selfId' } as const, '')
const hostGroups = atom({ plugin: 'session-map', key: 'hostGroups' } as const, [] as HostGroup[])
const selfHostId = atom({ plugin: 'session-map', key: 'selfHostId' } as const, '')
const tab = atom({ plugin: 'session-map', key: 'tab' } as const, 'sections' as PaneTab)
const openProject = atom({ plugin: 'session-map', key: 'project' } as const, '')

const TABS: { id: PaneTab; label: string }[] = [
  { id: 'sections', label: '섹션 목록' },
  { id: 'tasks', label: '작업 목록' },
]

let dir = ''
let self: SessionEntry | undefined
let heartbeat: { cancel: () => void } | undefined
/** 데스크톱 앱의 세션 목록 도구를 부를 수 없는 세션(터미널 등)에서는 다시 시도하지 않는다 */
let hasHostTools = true

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
    const entry = JSON.parse(typeof text === 'string' ? text : '') as SessionEntry
    return { ...entry, hostId: entry.hostId ?? '', now: entry.now ?? '', relatedIds: entry.relatedIds ?? [], refs: entry.refs ?? [] }
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

/** MCP 도구 결과는 JSON 텍스트로 온다. 결과 모양이 달라도 첫 텍스트를 읽는다 */
function toolJson(result: unknown): unknown {
  if (result && typeof result === 'object') {
    const one = result as { text?: unknown; content?: unknown; result?: unknown }
    if (typeof one.text === 'string') return JSON.parse(one.text)
    if (Array.isArray(one.content)) {
      const text = (one.content as { text?: unknown }[]).find(part => typeof part.text === 'string')?.text
      if (typeof text === 'string') return JSON.parse(text)
    }
    if (one.result !== undefined) return toolJson(one.result)
  }
  if (typeof result === 'string') return JSON.parse(result)
  return result
}

/** 데스크톱 앱의 세션 목록을 읽는다. 목록에는 이 세션이 빠져 있어, 이 세션은 따로 읽어 붙인다 */
async function refreshHost($: EngineInterface): Promise<void> {
  if (!hasHostTools) return
  try {
    const listed = toolJson(await $.tool.call({ tool: 'mcp__ccd_session_mgmt__list_sessions', limit: HOST_LIMIT } as never))
    const mine = toolJson(await $.tool.call({ tool: 'mcp__ccd_session_mgmt__get_session', session_id: 'self' } as never))
    const list = Array.isArray(listed) ? (listed as HostSession[]) : []
    if (mine && typeof mine === 'object' && 'sessionId' in mine) {
      const me = mine as HostSession & { parentSessionId?: string }
      list.push({ ...me, startedBy: me.startedBy ?? me.parentSessionId })
    }
    await update($, hostSessions, () => list)
    // 그룹 순서는 섹션 목록의 순서에만 쓰므로, 읽지 못해도 세션 목록은 그대로 둔다
    const groups = toolJson(await $.tool.call({ tool: 'mcp__ccd_sidebar__list_groups' } as never).catch(() => undefined))
    if (Array.isArray(groups)) await update($, hostGroups, () => groups as HostGroup[])
  } catch {
    hasHostTools = false
  }
}

async function refreshAll($: EngineInterface): Promise<void> {
  await refresh($).catch(() => undefined)
  await refreshHost($)
}

function contextText(list: SessionEntry[], me: SessionEntry): string {
  const now = Date.now()
  const titleOf = (id: string) => list.find(one => one.id === id || one.hostId === id)?.title || id.slice(0, 8)
  const others = list
    .filter(one => one.id !== me.id && now - one.lastSeen < CONTEXT_WINDOW_MS)
    .slice(-CONTEXT_LIMIT)
  const lines = [
    '세션 맵 (모든 세션이 공유하는 세션 목록)',
    '',
    `이 세션: id ${me.hostId || me.id}, 제목 "${me.title || '(없음)'}", 목적 "${me.purpose || '(없음)'}"${me.parentId ? `, 상위 세션 ${titleOf(me.parentId)} (${me.parentId})` : ''}`,
    '',
    others.length ? '최근 24시간의 다른 세션:' : '최근 24시간에 다른 세션은 없다.',
    ...others.map(one => {
      const parent = one.parentId ? `, 상위 ${titleOf(one.parentId)}` : ''
      const state = one.status === 'ended' ? '종료' : '진행 중'
      return `- [${state}] ${one.title || '(제목 없음)'}: ${one.now || one.purpose || '(목적 없음)'} (id ${one.hostId || one.id}, 폴더 ${one.cwd}${parent})`
    }),
    '',
    `규칙: 이 세션의 제목이나 목적이 비어 있거나 작업 내용이 바뀌면 ${TOOL} 도구로 적는다. 하위 세션을 시작할 때는 지시문에 "상위 세션 id: ${me.hostId || me.id}" 를 넣는다. 받은 지시문에 상위 세션 id 가 있으면 ${TOOL} 도구의 parentId 로 적는다. 사용자가 이 작업이 다른 세션이나 다른 프로젝트의 작업에서 곁가지로 나왔다고 하면, 그 세션 id 를 ${TOOL} 도구의 relatedId 로 적는다.`,
  ]
  return lines.join('\n')
}

async function openSession($: EngineInterface, link: string): Promise<void> {
  if (!link) {
    $.ui.toast('이 세션은 데스크톱 앱 세션이 아니라 열 수 없다.')
    return
  }
  await $.process.run(['open', link]).catch(() => $.ui.toast('세션을 열지 못했다.'))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'session-map',
      description: '섹션(사이드바 그룹)별·작업별로 세션의 플로우를 보여 주는 패널을 연다',
    })
    await $.tool.register({
      name: TOOL,
      description:
        '이 세션의 제목, 목적, 상위 세션, 곁가지로 이어진 세션을 모든 세션이 공유하는 세션 맵에 적는다. 바꿀 필드만 보낸다.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '세션 제목, 짧은 명사구' },
          purpose: { type: 'string', description: '이 세션이 처리하려는 일, 한 문장' },
          parentId: { type: 'string', description: '상위 세션 id. 지시문에 "상위 세션 id" 가 있을 때만 보낸다' },
          relatedId: {
            type: 'string',
            description: '이 작업이 곁가지로 나온 다른 세션의 id. 사용자가 그렇다고 말했을 때만 보낸다',
          },
        },
      },
      isDeferred: false,
    })

    const id = await $.session.id()
    const hostId = (await $.env.get('CLAUDE_CODE_HOST_SESSION_ID').catch(() => undefined)) ?? ''
    const before = await readEntry($, `${await registryDir($)}/${id}.json`)
    const now = Date.now()
    self = {
      id,
      hostId,
      title: before?.title ?? '',
      purpose: before?.purpose ?? '',
      now: before?.now ?? '',
      parentId: before?.parentId ?? '',
      relatedIds: before?.relatedIds ?? [],
      refs: before?.refs ?? [],
      cwd: await $.session.cwd(),
      startedAt: before?.startedAt ?? now,
      lastSeen: now,
      status: 'active',
    }
    await update($, selfId, () => id)
    await update($, selfHostId, () => hostId)
    await writeSelf($).catch(() => undefined)
    await refresh($).catch(() => undefined)

    heartbeat?.cancel()
    try {
      heartbeat = $.clock.every(HEARTBEAT_MS, () => {
        void writeSelf($).then(() => refreshAll($)).catch(() => undefined)
      })
    } catch {
      heartbeat = undefined
    }

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

  // 턴을 마칠 때 남기는 요약을 이 세션의 지금 상태로 둔다
  on('tool.call', { tool: 'mcp__ccd_turn__wrap_up' }, async ($, e, next) => {
    const recap = (e as unknown as { recap?: unknown }).recap
    if (typeof recap === 'string' && recap.trim()) await writeSelf($, { now: recap.trim() }).catch(() => undefined)
    return next(e)
  })

  // gh issue|pr 쓰기 명령으로 다룬 이슈·PR 을 이 세션의 기록에 남긴다
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (!self || !/\bgh\s+(issue|pr)\b/.test(e.command)) return ran
    try {
      const repo = await $.session.repo().catch(() => null)
      const found = refsOfGhCommand(e.command, JSON.stringify(ran), repoOfRemote(repo?.remote ?? ''))
      if (found.length) await writeSelf($, { refs: mergeRefs(self.refs, found) })
    } catch {
      // 기록하지 못해도 명령 결과는 그대로 돌려준다
    }
    return ran
  })

  on('tool.call', { tool: `mcp__session-map__${TOOL}` }, async ($, e) => {
    if (!self) return { result: '세션이 아직 등록되지 않았다.' }
    const input = e as unknown as { title?: unknown; purpose?: unknown; parentId?: unknown; relatedId?: unknown }
    const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
    const patch: Partial<SessionEntry> = {}
    if (text(input.title)) patch.title = text(input.title)
    if (text(input.purpose)) patch.purpose = text(input.purpose)
    const isOther = (value: string) => value && value !== self!.id && value !== self!.hostId
    if (isOther(text(input.parentId))) patch.parentId = text(input.parentId)
    if (isOther(text(input.relatedId)) && !self.relatedIds.includes(text(input.relatedId))) {
      patch.relatedIds = [...self.relatedIds, text(input.relatedId)]
    }
    const isSaved = await writeSelf($, patch).then(() => true, () => false)
    if (!isSaved) return { result: '세션 맵 파일을 쓰지 못했다.' }
    await refresh($).catch(() => undefined)
    return { result: `세션 맵에 적었다: ${JSON.stringify({ id: self.hostId || self.id, ...patch })}` }
  })

  on('command.run', { command: 'session-map' }, async $ => {
    await refreshAll($)
    await $.ui.open({ id: PANE, title: '세션 맵' })
    return { text: '세션 맵 패널을 열었다.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : undefined
    const entries = await read($, sessions)
    const hosts = await read($, hostSessions)
    const selfKey = (await read($, selfHostId)) || (await read($, selfId))
    const groups = await read($, hostGroups)
    const current = await read($, tab)
    const project = await read($, openProject)
    const nodes = toNodes(entries, hosts, Date.now())
    const taskList = tasks(nodes)
    const pick = (name: string) => () => void update($, openProject, () => name)

    const tabBar = (
      <Box key="tabs" flexDirection="row" gap={2}>
        {TABS.map(one => (
          <Button
            key={`tab-${one.id}`}
            plain
            onPress={() => {
              void update($, tab, () => one.id)
              void update($, openProject, () => '')
            }}
          >
            {one.id === current ? <Text bold underline>{one.label}</Text> : <Text dimColor>{one.label}</Text>}
          </Button>
        ))}
      </Box>
    )
    const refsText = (list: FlowNode['refs']) => list.map(refLabel).join(' · ')

    if (!project && current === 'sections') {
      const rows = sections(nodes, groups)
      return (
        <Box flexDirection="column">
          {tabBar}
          <Text dimColor>섹션 {rows.length}개 · 왼쪽 사이드바 순서 · 누르면 세션 플로우를 연다</Text>
          {rows.length === 0 && <Text dimColor>등록된 세션이 없다.</Text>}
          {rows.map(row => (
            <Button key={`section-${row.name}`} plain onPress={pick(row.name)}>
              ▸ <Text bold>{row.name}</Text>
              <Text dimColor>
                {'  '}세션 {row.total} · 진행 중 {row.running}
              </Text>
            </Button>
          ))}
        </Box>
      )
    }

    if (!project) {
      return (
        <Box flexDirection="column">
          {tabBar}
          <Text dimColor>
            작업 {taskList.length}개 · 시작 관계·곁가지·같은 이슈·PR 로 이어진 세션을 한 작업으로 묶는다
          </Text>
          {taskList.map(task => (
            <Box key={`task-${task.id}`} flexDirection="column" marginTop={1}>
              <Button key={`task-open-${task.id}`} plain onPress={pick(task.id)}>
                ▸ <Text bold>{task.title}</Text>
                <Text dimColor>
                  {'  '}세션 {task.total} · 진행 중 {task.running} · 완료 {task.done}
                </Text>
              </Button>
              <Text dimColor>   섹션: {task.sections.join(', ')}</Text>
              {task.refs.length ? <Text dimColor>   {refsText(task.refs)}</Text> : ''}
            </Box>
          ))}
        </Box>
      )
    }

    const task = current === 'tasks' ? taskList.find(one => one.id === project) : undefined
    const heading = task ? task.title : project
    const flow = layoutFlow(nodes, task ? task.keys : project)
    const sessionRow = (node: FlowNode, external: boolean) => (
      <Box key={`node-${node.key}`} flexDirection="column" marginTop={1}>
        <Button key={`open-${node.key}`} plain onPress={() => void openSession($, node.link)}>
          {STATUS_MARK[node.status]} <Text bold>{node.title}</Text>
          {node.key === selfKey ? <Text color="magenta"> (이 세션)</Text> : ''}
          <Text dimColor>
            {'  '}
            {external ? '↗ ' : ''}
            {external || task ? `${node.project} · ` : ''}
            {STATUS_LABEL[node.status]}
          </Text>
        </Button>
        {node.refs.length ? <Text dimColor>   {refsText(node.refs)}</Text> : ''}
        {node.purpose ? <Text dimColor>   목적: {node.purpose}</Text> : ''}
        {node.now ? <Text dimColor>   지금: {node.now}</Text> : ''}
      </Box>
    )

    return (
      <Box flexDirection="column">
        {tabBar}
        <Button key="back" plain onPress={pick('')}>
          ◀ {current === 'tasks' ? '작업 목록' : '섹션 목록'}
        </Button>
        <Text bold>{heading}</Text>
        {Svg ? (
          <Svg source={flowSvg(flow, selfKey, !!task)} alt={`${heading} 세션 플로우`} isInteractive />
        ) : (
          flow.placed.map(p => (
            <Text key={`tree-${p.node.key}`}>
              {'   '.repeat(p.col)}
              {p.col ? '└─▶ ' : ''}
              {STATUS_MARK[p.node.status]} {p.node.title}
              {p.external ? ` (↗ ${p.node.project})` : ''}
            </Text>
          ))
        )}
        <Text dimColor>세션 제목을 누르면 그 세션으로 이동한다</Text>
        {flow.placed.map(p => sessionRow(p.node, p.external))}
      </Box>
    )
  })
}
