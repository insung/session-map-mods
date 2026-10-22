import { expect, test } from 'claude-code/testing'

import { fitLines, flowSvg, layoutFlow, sections, tasks, toNodes } from '../hooks/graph'
import { refsOfGhCommand, refsOfTitle } from '../hooks/refs'
import { ENTRIES, GROUPS, HOSTS, NOW } from './fixtures'

const nodes = toNodes(ENTRIES, HOSTS, NOW)
const DASH = '2610_커스텀-대시보드'

test('sections follow the sidebar order', async () => {
  const rows = sections(nodes, GROUPS)
  expect(rows.map(row => row.name)).toEqual(['2610_blackbox-mods', DASH, '2610_mi.daily-report.batch'])
  expect(rows[1]).toMatchObject({ total: 5, running: 1 })
})

test('sessions linked by start, side work or a shared issue form one task', async () => {
  const list = tasks(nodes)
  const keysOf = (title: string) => list.find(one => one.title === title)?.keys.slice().sort()
  // 기획 검토가 시작한 세션들과, 그 하위가 다른 섹션에서 시작한 배치 세션까지 한 작업이다
  expect(keysOf('커스텀 대시보드 기획 검토')).toEqual(['local_a', 'local_b', 'local_c', 'local_x'])
  // 위젯 시안과 같은 이슈 #12 를 다룬 API 연결, 곁가지로 이어 둔 렌더 버그 수정이 한 작업이다
  expect(keysOf('프론트 위젯 시안')).toEqual(['local_d', 'local_e', 'local_f'])
  // 아무것과도 이어지지 않은 세션은 혼자 작업이 된다
  expect(keysOf('배치 로그 모니터링')).toEqual(['local_g'])
  const plan = list.find(one => one.title === '커스텀 대시보드 기획 검토')!
  expect(plan.sections).toEqual([DASH, '2610_mi.daily-report.batch'])
  expect(plan.refs.map(ref => `${ref.kind}#${ref.number}`).sort()).toEqual(['issue#30', 'issue#33', 'pr#39', 'pr#42', 'pr#47'])
})

test('the task title drops the done mark and issue number', async () => {
  const solo = tasks(toNodes([], [HOSTS.find(one => one.sessionId === 'local_f')!], NOW))
  expect(solo[0]?.title).toBe('위젯 API 연결')
})

test('a session started from another sits to its right', async () => {
  const flow = layoutFlow(nodes, DASH)
  const col = (key: string) => flow.placed.find(p => p.node.key === key)?.col
  expect(col('local_a')).toBe(0)
  expect(col('local_b')).toBe(1)
  expect(col('local_c')).toBe(1)
  expect(flow.edges).toContainEqual({ from: 'local_a', to: 'local_c', kind: 'started' })
})

test('sessions of another section are linked as external nodes', async () => {
  const flow = layoutFlow(nodes, DASH)
  const external = flow.placed.filter(p => p.external).map(p => p.node.key)
  expect(external.sort()).toEqual(['local_e', 'local_x'])
  expect(flow.edges).toContainEqual({ from: 'local_c', to: 'local_x', kind: 'started' })
  expect(flow.edges).toContainEqual({ from: 'local_d', to: 'local_e', kind: 'related' })
})

test('a task flow keeps sessions of every section inside', async () => {
  const plan = tasks(nodes).find(one => one.title === '커스텀 대시보드 기획 검토')!
  const flow = layoutFlow(nodes, plan.keys)
  expect(flow.placed.filter(p => p.external)).toHaveLength(0)
  expect(flow.placed.find(p => p.node.key === 'local_x')?.col).toBe(2)
})

test('the other section shows where its session came from', async () => {
  const flow = layoutFlow(nodes, '2610_mi.daily-report.batch')
  expect(flow.placed.find(p => p.node.key === 'local_c')).toMatchObject({ external: true, col: 0 })
  expect(flow.placed.find(p => p.node.key === 'local_x')).toMatchObject({ external: false, col: 1 })
})

test('the flow draws issues and PRs inside each box', async () => {
  const svg = flowSvg(layoutFlow(nodes, DASH), 'local_c')
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg).toContain('PR #42 머지')
  expect(svg).toContain('Issue #33')
  // 같은 번호의 PR 을 데스크톱 목록과 기록이 함께 알려도 한 번만 그린다
  expect(svg.match(/PR #39/g)).toHaveLength(1)
})

test('issues and PRs come from gh write commands and session titles', async () => {
  expect(refsOfGhCommand('gh issue close 12 --comment "done"', '', 'insung/mi')).toEqual([{ kind: 'issue', repo: 'insung/mi', number: 12, state: 'closed' }])
  expect(refsOfGhCommand('gh pr view 12', '', 'insung/mi')).toEqual([])
  expect(refsOfGhCommand('GH_TOKEN=x gh pr create --title t', 'https://github.com/insung/mi/pull/48\n', '')).toEqual([
    { kind: 'pr', repo: 'insung/mi', number: 48, state: 'open' },
  ])
  expect(refsOfTitle('#1 일일 리포트 배치')).toEqual([{ kind: 'issue', repo: '', number: 1 }])
  expect(refsOfTitle('Issue #4 계획 및 검증')).toEqual([{ kind: 'issue', repo: '', number: 4 }])
})

test('long text is cut to the box width, at most two lines', async () => {
  const recap = 'session-map-mods 에 프로젝트별 세션 플로우, 다른 프로젝트 세션 연결, 제목을 누르면 그 세션으로 이동하는 기능을 넣고 테스트 7개를 통과시켰다'
  const lines = fitLines(recap, 11, 196, 2)
  expect(lines).toHaveLength(2)
  expect(lines[1].endsWith('…')).toBe(true)
  // 한글은 글자 크기만큼 넓어, 한 줄에 17자(11px × 17 = 187px)를 넘지 않는다
  expect(fitLines('가'.repeat(40), 11, 196, 2)[0]).toBe('가'.repeat(17))
  expect(fitLines('짧은 설명', 11, 196, 2)).toEqual(['짧은 설명'])
})
