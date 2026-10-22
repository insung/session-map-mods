import { expect, test } from 'claude-code/testing'

const NOW = Date.now()
const entry = (id: string, title: string, purpose: string, parentId: string, status: string, ago: number) =>
  JSON.stringify({ id, title, purpose, parentId, cwd: '/Users/me/Documents/Github/pay-api', startedAt: NOW - ago - 1000, lastSeen: NOW - ago, status })

const FILES: Record<string, string> = {
  'a.json': entry('47ffc6fb-1bc9', '결제 API 리팩터링', '결제 모듈의 중복 코드를 정리한다', '', 'active', 1000),
  'b.json': entry('90af269e-3771', '결제 API 테스트 보강', '리팩터링한 결제 모듈에 테스트를 추가한다', '47ffc6fb-1bc9', 'active', 2000),
  'c.json': entry('5d21aa03-9f10', '테스트 픽스처 정리', '중복 픽스처를 한 파일로 모은다', '90af269e-3771', 'ended', 60_000),
  'd.json': entry('c8e04b7a-2a6e', '세션 맵 mod', '모든 세션이 공유하는 세션 목록을 만든다', '', 'active', 30 * 60_000),
}

test('the pane draws sessions as a parent and child tree', async ($, on) => {
  on('command.register', () => ({ value: { command: 'session-map' } }))
  on('tool.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('env.get', (_, e) => ({ value: (e as { name?: string }).name === 'HOME' ? '/Users/me' : '/reg' }))
  on('session.id', () => ({ value: '47ffc6fb-1bc9' }))
  on('session.cwd', () => ({ value: '/Users/me/Documents/Github/pay-api' }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', () => ({ value: Object.keys(FILES).map(name => ({ name, kind: 'file', size: 1, mtimeMs: NOW, isLink: false })) }))
  on('fs.read', (_, e) => {
    const path = String((e as { path?: string }).path)
    return { value: FILES[path.split('/').pop() ?? ''] ?? '' }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: 'session-map',
    component: 'Pane',
    requestId: 'session-map',
    surface: 'terminal',
    props: { title: '세션 목록', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as never)
  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
  expect(texts.some(text => /└─ .*결제 API 테스트 보강/.test(text ?? ''))).toBe(true)
  await ui.unmount()
})
