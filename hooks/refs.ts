import type { Ref } from '../types'

const URL_REF = /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)/g
const GH_COMMAND = /\bgh\s+(issue|pr)\s+([a-z-]+)([^\n;&|]*)/g
/** 이 명령들은 읽기만 해, 세션이 다룬 이슈·PR 로 보지 않는다 */
const READ_ONLY = new Set(['view', 'list', 'status', 'diff', 'checks'])

/** git remote URL 에서 GitHub owner/repo 를 꺼낸다. GitHub 이 아니거나 비었으면 '' */
export function repoOfRemote(url: string): string {
  const m = url.trim().match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/)
  return m ? `${m[1]}/${m[2]}` : ''
}

/** 셸이 실제로 실행하는 부분만 남긴다: heredoc 본문과 따옴표 안 문자열은 명령이 아니라 데이터다 */
function executedPart(command: string): string {
  return command
    .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\s|$)/g, '<<heredoc')
    .replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, "''")
}

/**
 * gh issue|pr 쓰기 명령에서 세션이 다룬 이슈·PR 을 찾는다.
 * 저장소는 --repo, URL, 명령을 실행한 폴더의 origin 순서로 정한다. 번호가 없는 create 는 결과의 URL 로 잇는다.
 */
export function refsOfGhCommand(command: string, output: string, defaultRepo: string): Ref[] {
  const found: Ref[] = []
  for (const m of executedPart(command).matchAll(GH_COMMAND)) {
    const kind = m[1] === 'pr' ? 'pr' : 'issue'
    const action = m[2] ?? ''
    if (READ_ONLY.has(action)) continue
    const rest = m[3] ?? ''
    const state = action === 'close' ? 'closed' : action === 'merge' ? 'merged' : action === 'reopen' ? 'open' : undefined
    const repoArg = rest.match(/(?:--repo|-R)[\s=]+([\w.-]+\/[\w.-]+)/)?.[1]
    const urlArg = [...rest.matchAll(URL_REF)][0]
    const numberArg = rest.match(/(?:^|\s)#?(\d+)(?=\s|$)/)?.[1]
    if (urlArg) {
      found.push({ kind: urlArg[3] === 'pull' ? 'pr' : 'issue', repo: `${urlArg[1]}/${urlArg[2]}`, number: Number(urlArg[4]), state })
    } else if (numberArg && (repoArg || defaultRepo)) {
      found.push({ kind, repo: repoArg || defaultRepo, number: Number(numberArg), state })
    } else if (action === 'create') {
      for (const url of output.matchAll(URL_REF)) {
        found.push({ kind: url[3] === 'pull' ? 'pr' : 'issue', repo: `${url[1]}/${url[2]}`, number: Number(url[4]), state: 'open' })
      }
    }
  }
  return found.filter(one => one.number > 0)
}

/** 세션 제목의 `#12`, `Issue #12` 를 이슈로 본다. 저장소는 모르므로 비워 둔다 */
export function refsOfTitle(title: string): Ref[] {
  return [...title.matchAll(/(?:^|[\s(\[])(?:issue\s*)?#(\d+)\b/gi)].map(m => ({ kind: 'issue' as const, repo: '', number: Number(m[1]) }))
}

export function refKey(ref: Ref): string {
  return `${ref.kind}:${ref.repo}#${ref.number}`
}

/** 같은 이슈·PR 은 하나로 합치고, 나중에 알게 된 상태가 앞의 상태를 덮는다 */
export function mergeRefs(list: readonly Ref[], added: readonly Ref[]): Ref[] {
  const map = new Map(list.map(one => [refKey(one), one]))
  for (const one of added) {
    const before = map.get(refKey(one))
    map.set(refKey(one), { ...before, ...one, state: one.state ?? before?.state })
  }
  return [...map.values()]
}

export function refLabel(ref: Ref): string {
  const state = ref.state === 'merged' ? ' 머지' : ref.state === 'closed' ? ' 닫힘' : ''
  return `${ref.kind === 'pr' ? 'PR' : 'Issue'} #${ref.number}${state}`
}
