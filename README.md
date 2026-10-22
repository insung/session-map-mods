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
