import { expect, test } from 'claude-code/testing'

import { flowSvg, layoutFlow, projects, toNodes } from '../hooks/graph'
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
