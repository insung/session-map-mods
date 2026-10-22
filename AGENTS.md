## Git workflow

이 프로젝트는 git-workflow를 따른다.
Issue가 필요한 작업은 Issue 생성 → Issue 계획 작성 → 별도 에이전트 구현 → 메인 독립 검증 → PR 검토 → 사용자 승인 후 머지 → Issue 종료 순서로 진행한다.

- 메인은 계획·위임·독립 검증과 승인된 전달을 조정하고 직접 구현하지 않으며, Issue 기반 구현은 이전 대화를 상속하지 않는 별도 구현 에이전트에게 맡긴다. 공통 구현 절차(`skills/git-workflow/references/implementation.md`)에 따라 공개 계약·작업 경계·결과를 인계하고 실패하면 수정 후 재검증한다.
- 검증 준비와 실행 경계(`skills/git-workflow/references/execution-boundaries.md`)를 따른다. 공개 기준으로 충분하면 별도 입력·리뷰 위치 없이 진행하며 필요한 입력 미준비만 관련 구현을 보류한다. 독립 기준 보관(`skills/git-workflow/references/review-criteria.md`)에 따라 비공개 검토 기준·검증 입력은 구현자에게 전달하지 않는다. 이를 작성하거나 읽은 세션은 해당 Issue를 구현하지 않는다.
- 요청 범위와 행동·대상별 승인을 따른다. 읽기 전용 질문·Issue 작성만 요청한 경우에는 구현으로 확대하지 않는다.

코드의 의도·맥락 또는 변경 영향을 조사해 달라는 요청에는 git-history를 사용한다. 조사 결과와 근거를 설명하고, 구현은 승인된 범위에서 기존 워크플로우로 진행한다.

- 작업 단위·경미한 정합성 보완의 Issue 예외·후속 보고는 공통 기준(`skills/git-workflow/references/outcome-scope.md`)을 읽고 따른다.

## 브랜치 전략

브랜치 생성·PR 대상 결정·hotfix 작업 전에 [README.md 의 브랜치 전략](README.md#브랜치-전략)을 읽고 따른다. Issue 생성·릴리즈 전에는 [README.md 의 마일스톤](README.md#마일스톤)을 읽는다.
규칙이 충돌하거나 필요한 항목이 미정이면 관련 행동 전에 확인한다.
