import type { HostGroup, HostSession, Ref, SessionEntry } from '../types'

export const NOW = Date.parse('2026-10-22T18:00:00Z')
const at = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

const DASH = { id: 'g1', name: '2610_커스텀-대시보드' }
const BATCH = { id: 'g2', name: '2610_mi.daily-report.batch' }
const MODS = { id: 'g3', name: '2610_blackbox-mods' }

/** 사이드바 순서: blackbox-mods, 커스텀 대시보드, 배치 */
export const GROUPS: HostGroup[] = [
  { ...MODS, order: 0 },
  { ...DASH, order: 1 },
  { ...BATCH, order: 2 },
]

export const HOSTS: HostSession[] = [
  { sessionId: 'local_a', title: '커스텀 대시보드 기획 검토', cwd: '/w/mi', isRunning: false, lastActivityAt: at(300), group: DASH, link: 'claude://claude.ai/epitaxy/local_a', prNumber: 39, prState: 'MERGED' },
  { sessionId: 'local_b', title: '백엔드 상세 설계 보완안', cwd: '/w/mi', isRunning: false, lastActivityAt: at(240), group: DASH, startedBy: 'local_a', link: 'claude://claude.ai/epitaxy/local_b', prNumber: 42, prState: 'MERGED' },
  { sessionId: 'local_c', title: 'AI 비용 추정', cwd: '/w/mi', isRunning: true, lastActivityAt: at(5), group: DASH, startedBy: 'local_a', link: 'claude://claude.ai/epitaxy/local_c' },
  { sessionId: 'local_x', title: '일일 리포트 배치 비용 반영', cwd: '/w/mi', isRunning: true, lastActivityAt: at(3), group: BATCH, startedBy: 'local_c', link: 'claude://claude.ai/epitaxy/local_x' },
  { sessionId: 'local_d', title: '프론트 위젯 시안', cwd: '/w/mi', isRunning: false, lastActivityAt: at(60), group: DASH, link: 'claude://claude.ai/epitaxy/local_d' },
  { sessionId: 'local_f', title: '[완료] #12 위젯 API 연결', cwd: '/w/mi', isRunning: false, lastActivityAt: at(50), group: DASH, link: 'claude://claude.ai/epitaxy/local_f' },
  { sessionId: 'local_e', title: '패널 렌더 버그 수정', cwd: '/w/bb', isRunning: false, lastActivityAt: at(30), group: MODS, link: 'claude://claude.ai/epitaxy/local_e' },
  { sessionId: 'local_g', title: '배치 로그 모니터링', cwd: '/w/mi', isRunning: false, lastActivityAt: at(10), group: BATCH, link: 'claude://claude.ai/epitaxy/local_g' },
]

const MI = 'insung/mi'
const entry = (id: string, hostId: string, purpose: string, now: string, startedMin: number, refs: Ref[] = [], relatedIds: string[] = []): SessionEntry => ({
  id, hostId, title: '', purpose, now, parentId: '', relatedIds, refs, cwd: '/w/mi', startedAt: NOW - startedMin * 60_000, lastSeen: NOW, status: 'active',
})

export const ENTRIES: SessionEntry[] = [
  entry('cli-a', 'local_a', '대시보드 기획서를 검토한다', '기획 검토 의견 반영 완료', 300, [{ kind: 'issue', repo: MI, number: 30, state: 'closed' }, { kind: 'pr', repo: MI, number: 39, state: 'merged' }]),
  entry('cli-b', 'local_b', '백엔드 설계를 보완한다', '구성도와 보완안 정리 완료', 250, [{ kind: 'pr', repo: MI, number: 42, state: 'merged' }]),
  entry('cli-c', 'local_c', 'AI 호출 비용을 추정한다', '모델별 단가 표를 정리하고 일일 리포트 배치에 비용 집계를 넣기 위해 하위 세션을 만들어 쿼리를 검증하는 중', 200, [{ kind: 'issue', repo: MI, number: 33 }]),
  entry('cli-x', 'local_x', '배치에 비용 집계를 넣는다', '집계 쿼리 검증 중', 20, [{ kind: 'issue', repo: MI, number: 33 }, { kind: 'pr', repo: MI, number: 47 }]),
  entry('cli-d', 'local_d', '위젯 화면 시안을 만든다', '카드형 시안 2안 비교', 100, [{ kind: 'issue', repo: MI, number: 12 }]),
  entry('cli-f', 'local_f', '위젯 데이터 API 를 연결한다', 'API 연결과 테스트 완료', 90, [{ kind: 'issue', repo: MI, number: 12, state: 'closed' }, { kind: 'pr', repo: MI, number: 45, state: 'merged' }]),
  entry('cli-e', 'local_e', '패널이 위젯 시안 작업 중 깨진 것을 고친다', '원인 파악: 긴 제목 줄바꿈', 40, [], ['local_d']),
]
