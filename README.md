# session-map-mods

여러 Claude Code 세션을 섹션(데스크톱 사이드바 그룹)별·작업별 플로우로 보여 주는 mod.

`/session-map` 으로 패널을 연다.

| 탭 | 보여 주는 것 |
| --- | --- |
| 섹션 목록 | 사이드바와 같은 순서의 섹션. 누르면 그 섹션 세션들의 플로우 |
| 작업 목록 | 시작 관계·곁가지·같은 이슈·PR 로 이어진 세션을 묶은 작업. 누르면 그 작업의 플로우 |

플로우의 칸마다 세션 상태, 지금 하는 일(턴 마무리 요약), 다룬 이슈·PR 이 보인다. 다른 섹션의 세션은 점선 칸이다. 플로우 아래 세션 제목을 누르면 그 세션으로 이동한다.

## 로컬 설치

```bash
claude plugin marketplace add ~/Documents/Github/my-workspace/session-map-mods
```

```bash
claude plugin install session-map@session-map-mods --scope user
```

설치 뒤 새로 시작한 세션부터 로드된다. 로컬 marketplace 는 이 폴더를 그대로 읽으므로, 코드를 고친 뒤에는 새 세션을 시작하면 반영된다.

지우려면:

```bash
claude plugin uninstall session-map@session-map-mods
```

## 기록 위치

세션마다 `~/.claude/session-map/<세션 id>.json` 에 자기 파일만 쓴다. 시험할 때는 `SESSION_MAP_DIR` 로 다른 폴더를 쓴다.

## 테스트

```bash
claude plugin test .
```

## 브랜치 전략

GitHub Flow 를 따른다. 이 절이 이 저장소의 브랜치 전략 정본이다.

| 구분 | 규칙 |
| --- | --- |
| 일반 작업 | 최신 `main` 에서 `<type>/<주제>` 브랜치를 만든다 (예: `feat/task-tab`). 워크트리는 `.worktree/<type>-<주제>` 에 둔다. PR 대상은 `main` 이고 Merge commit 으로 머지한다. `main` 에 직접 push 하지 않는다. |
| 긴급 수정 | 운영 브랜치가 따로 없다. 일반 작업과 같이 `main` → `fix/<주제>` → `main` PR 로 처리한다. |
| 배포 | 로컬 marketplace 가 이 폴더를 그대로 읽으므로 배포 트리거가 없다. 릴리즈할 때 `.claude-plugin/plugin.json` 의 `version` 을 올린 `main` 커밋에 `vX.Y.Z` 태그를 붙인다. 롤백은 되돌리는 커밋을 PR 로 머지한다. |
| 미정·충돌 | 이 절과 다른 지시가 있거나 정하지 않은 항목이 있으면 브랜치 생성·PR·머지 전에 확인한다. |

## 마일스톤

| 항목 | 기준 |
| --- | --- |
| 이름 | `vX.Y.Z`. `plugin.json` 의 `version`, git 태그와 같다. |
| 연결 | Issue 를 마일스톤에 연결한다. PR 은 연결한 Issue 로 추적한다. |
| 기한 | 출시일을 합의한 경우에만 정한다. |
| 발행 | 마일스톤의 Issue 가 모두 닫히고 `version` 과 태그가 같으면 Release 를 발행한다. |
| 종료 | Release 발행을 확인하고 사용자가 승인하면 닫는다. |
