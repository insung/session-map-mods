import { expect, test } from 'claude-code/testing'

import { ENTRIES, HOSTS } from './fixtures'

const PANE = {
  plugin: 'session-map',
  component: 'Pane',
  requestId: 'session-map',
  props: { title: '세션 맵', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const FILES = Object.fromEntries(ENTRIES.map(one => [`${one.id}.json`, JSON.stringify({ ...one, lastSeen: Date.now() })]))

function engine(on: Parameters<Parameters<typeof test>[1]>[1], opened: string[]) {
  on('command.register', () => ({ value: { command: 'session-map' } }))
  on('tool.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('env.get', (_, e) => {
    const name = (e as { name?: string }).name
    return { value: name === 'CLAUDE_CODE_HOST_SESSION_ID' ? 'local_c' : name === 'HOME' ? '/Users/me' : '/reg' }
  })
  on('session.id', () => ({ value: 'cli-c' }))
  on('session.cwd', () => ({ value: '/w/mi' }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', () => ({ value: Object.keys(FILES).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })) }))
  on('fs.read', (_, e) => ({ value: FILES[String((e as { path?: string }).path).split('/').pop() ?? ''] ?? '' }))
  on('process.run', (_, e) => {
    opened.push(String((e as { argv?: string[] }).argv?.[1]))
    return { value: { stdout: '', stderr: '', code: 0 } }
  })
  on('tool.call', (_, e) => {
    const call = e as { tool: string }
    if (call.tool === 'mcp__ccd_session_mgmt__list_sessions') return { result: { text: JSON.stringify(HOSTS.filter(one => one.sessionId !== 'local_c')) } }
    if (call.tool === 'mcp__ccd_session_mgmt__get_session') return { result: { text: JSON.stringify(HOSTS.find(one => one.sessionId === 'local_c')) } }
    return { result: {} }
  })
  on('command.run', () => ({ text: '' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
}

test('the pane lists projects, opens a flow, and a title opens its session', async ($, on) => {
  const opened: string[] = []
  engine(on, opened)
  await $.session.start({ cwd: '/w/mi', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'session-map', args: '' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const project = await ui.find({ type: 'Button', text: /2610_커스텀-대시보드/ })
  expect(project).toBeDefined()
  await ui.press(project!)

  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  const title = await ui.find({ type: 'Button', text: /백엔드 상세 설계 보완안/ })
  await ui.press(title!)
  expect(opened).toEqual(['claude://claude.ai/epitaxy/local_b'])
  expect(await ui.find({ type: 'Text', text: /지금: 모델별 단가 표를 정리하고/ })).toBeDefined()
  await ui.unmount()
})

test('the terminal draws the flow as text', async ($, on) => {
  engine(on, [])
  await $.session.start({ cwd: '/w/mi', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'session-map', args: '' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press((await ui.find({ type: 'Button', text: /2610_커스텀-대시보드/ }))!)
  expect(await ui.find({ type: 'Text', text: /└─▶ ● AI 비용 추정/ })).toBeDefined()
  await ui.unmount()
})
