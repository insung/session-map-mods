export type SessionStatus = 'active' | 'ended'

/** 세션이 다룬 이슈·PR. repo 는 owner/name, 모르면 빈 문자열 */
export type Ref = { kind: 'issue' | 'pr'; repo: string; number: number; state?: 'open' | 'closed' | 'merged' }

/** 공유 폴더의 세션 파일 하나. 세션마다 자기 파일만 쓴다 */
export type SessionEntry = {
  id: string
  /** 데스크톱 앱의 세션 id (local_…). 터미널 세션이면 빈 문자열 */
  hostId: string
  title: string
  purpose: string
  /** 세션이 마지막 턴을 마치며 남긴 요약 */
  now: string
  parentId: string
  /** 상위·하위 관계는 아니지만 함께 보여 줄 세션 (다른 프로젝트에서 곁가지로 한 작업 등) */
  relatedIds: string[]
  /** 이 세션이 gh 쓰기 명령으로 다룬 이슈·PR */
  refs: Ref[]
  cwd: string
  startedAt: number
  lastSeen: number
  status: SessionStatus
}

/** 데스크톱 앱의 세션 목록 한 줄. list_sessions 결과에서 쓰는 필드만 둔다 */
export type HostSession = {
  sessionId: string
  title: string
  cwd: string
  isRunning: boolean
  lastActivityAt: string
  group?: { id: string; name: string } | null
  startedBy?: string
  link?: string
  prNumber?: number
  prState?: string
}

/** 데스크톱 앱 사이드바의 그룹(섹션) 하나 */
export type HostGroup = { id: string; name: string; order: number }

export type NodeStatus = 'running' | 'waiting' | 'idle' | 'done'

/** 플로우에 그리는 세션 하나. 데스크톱 목록과 공유 폴더 기록을 합친 값 */
export type FlowNode = {
  key: string
  title: string
  /** 사이드바 그룹(섹션) 이름 */
  project: string
  parentKey: string
  relatedKeys: string[]
  status: NodeStatus
  purpose: string
  now: string
  link: string
  cwd: string
  refs: Ref[]
  startedAt: number
}

export type PaneTab = 'sections' | 'tasks'

declare module 'claude-code' {
  interface PluginState {
    'session-map': {
      sessions: SessionEntry[]
      hostSessions: HostSession[]
      hostGroups: HostGroup[]
      selfId: string
      selfHostId: string
      tab: PaneTab
      /** 탭에서 펼친 섹션 이름이나 작업 id. 빈 문자열이면 목록 */
      project: string
    }
  }
}
