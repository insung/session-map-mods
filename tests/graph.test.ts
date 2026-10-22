import { expect, test } from 'claude-code/testing'

import { fitLines, flowSvg, layoutFlow, projects, toNodes } from '../hooks/graph'
import { ENTRIES, HOSTS, NOW } from './fixtures'

const nodes = toNodes(ENTRIES, HOSTS, NOW)
const DASH = '2610_커스텀-대시보드'

test('projects come from the sidebar groups, running ones first, then the most recent', async () => {
  const rows = projects(nodes)
  expect(rows.map(row => row.name)).toEqual(['2610_mi.daily-report.batch', DASH, '2610_blackbox-mods'])
  expect(rows[1]).toMatchObject({ total: 4, running: 1 })
})

test('a session started from another sits to its right', async () => {
  const flow = layoutFlow(nodes, DASH)
  const col = (key: string) => flow.placed.find(p => p.node.key === key)?.col
  expect(col('local_a')).toBe(0)
  expect(col('local_b')).toBe(1)
  expect(col('local_c')).toBe(1)
  expect(flow.edges).toContainEqual({ from: 'local_a', to: 'local_c', kind: 'started' })
})

test('sessions of another project are linked as external nodes', async () => {
  const flow = layoutFlow(nodes, DASH)
  const external = flow.placed.filter(p => p.external).map(p => p.node.key)
  // 대시보드의 AI 비용 추정이 배치 프로젝트 세션을 시작했고, blackbox-mods 세션은 위젯 시안의 곁가지다
  expect(external.sort()).toEqual(['local_e', 'local_x'])
  expect(flow.edges).toContainEqual({ from: 'local_c', to: 'local_x', kind: 'started' })
  expect(flow.edges).toContainEqual({ from: 'local_d', to: 'local_e', kind: 'related' })
})

test('the other project shows where its session came from', async () => {
  const flow = layoutFlow(nodes, '2610_mi.daily-report.batch')
  const parent = flow.placed.find(p => p.node.key === 'local_c')
  expect(parent).toMatchObject({ external: true, col: 0 })
  expect(flow.placed.find(p => p.node.key === 'local_x')).toMatchObject({ external: false, col: 1 })
})

test('the flow draws as an svg with one box per session', async () => {
  const svg = flowSvg(layoutFlow(nodes, DASH), 'local_c')
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg.match(/<rect /g)?.length).toBe(6)
  expect(svg).toContain('stroke-dasharray')
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
