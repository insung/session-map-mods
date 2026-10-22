export type SessionStatus = 'active' | 'ended'

/** 공유 폴더의 세션 파일 하나. 세션마다 자기 파일만 쓴다 */
export type SessionEntry = {
  id: string
  title: string
  purpose: string
  parentId: string
  cwd: string
  startedAt: number
  lastSeen: number
  status: SessionStatus
}

declare module 'claude-code' {
  interface PluginState {
    'session-map': { sessions: SessionEntry[]; selfId: string }
  }
}
