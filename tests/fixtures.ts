import type { HostSession, SessionEntry } from '../types'

export const NOW = Date.parse('2026-10-22T18:00:00Z')
const at = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

const DASH = { id: 'g1', name: '2610_커스텀-대시보드' }
const BATCH = { id: 'g2', name: '2610_mi.daily-report.batch' }
const MODS = { id: 'g3', name: '2610_blackbox-mods' }

export const HOSTS: HostSession[] = [
  { sessionId: 'local_a', title: '커스텀 대시보드 기획 검토', cwd: '/w/mi', isRunning: false, lastActivityAt: at(300), group: DASH, link: 'claude://claude.ai/epitaxy/local_a', prNumber: 39, prState: 'MERGED' },
  { sessionId: 'local_b', title: '백엔드 상세 설계 보완안', cwd: '/w/mi', isRunning: false, lastActivityAt: at(240), group: DASH, startedBy: 'local_a', link: 'claude://claude.ai/epitaxy/local_b', prNumber: 42, prState: 'MERGED' },
  { sessionId: 'local_c', title: 'AI 비용 추정', cwd: '/w/mi', isRunning: true, lastActivityAt: at(5), group: DASH, startedBy: 'local_a', link: 'claude://claude.ai/epitaxy/local_c' },
  { sessionId: 'local_x', title: '일일 리포트 배치 비용 반영', cwd: '/w/mi', isRunning: true, lastActivityAt: at(3), group: BATCH, startedBy: 'local_c', link: 'claude://claude.ai/epitaxy/local_x' },
  { sessionId: 'local_d', title: '프론트 위젯 시안', cwd: '/w/mi', isRunning: false, lastActivityAt: at(60), group: DASH, link: 'claude://claude.ai/epitaxy/local_d' },
  { sessionId: 'local_e', title: '패널 렌더 버그 수정', cwd: '/w/bb', isRunning: false, lastActivityAt: at(30), group: MODS, link: 'claude://claude.ai/epitaxy/local_e' },
]

const entry = (id: string, hostId: string, purpose: string, now: string, startedMin: number, relatedIds: string[] = []): SessionEntry => ({
  id, hostId, title: '', purpose, now, parentId: '', relatedIds, cwd: '/w/mi', startedAt: NOW - startedMin * 60_000, lastSeen: NOW, status: 'active',
})

export const ENTRIES: SessionEntry[] = [
  entry('cli-a', 'local_a', '대시보드 기획서를 검토한다', '기획 검토 의견 반영 완료', 300),
  entry('cli-b', 'local_b', '백엔드 설계를 보완한다', '구성도와 보완안 정리 완료', 250),
  entry('cli-c', 'local_c', 'AI 호출 비용을 추정한다', '모델별 단가 표 작성 중', 200),
  entry('cli-x', 'local_x', '배치에 비용 집계를 넣는다', '집계 쿼리 검증 중', 20),
  entry('cli-d', 'local_d', '위젯 화면 시안을 만든다', '카드형 시안 2안 비교', 100),
  entry('cli-e', 'local_e', '패널이 위젯 시안 작업 중 깨진 것을 고친다', '원인 파악: 긴 제목 줄바꿈', 40, ['local_d']),
]
