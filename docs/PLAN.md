# XSD 시각화/편집 도구 (XSD Visualizer) 구현 계획

## Context

XSD 파일을 트리 형태로 시각화하면서, 요소/타입 간의 참조(타입 참조, extension/restriction, group 참조 등) 관계도 별도로 파악할 수 있는 도구가 필요하다. 단순 시각화에 그치지 않고 트리를 직접 편집(구조 편집 + 속성/제약조건 편집)해서 다시 XSD로 저장할 수 있어야 하고, 편집된 스키마로부터 C/C++, Python 코드를 자동 생성할 수 있어야 한다. 향후 다른 언어(Java, C# 등)로 코드 생성 대상을 넓힐 수 있도록 코드 생성기는 모듈식/플러그인 구조로 설계한다.

실행 형태는 데스크톱 앱(Electron)으로 확정했고, 편집 범위는 구조 편집(노드 추가/삭제/이동, 참조 재연결)과 속성/제약조건 편집(이름, 타입, cardinality, facet 등) 둘 다 포함한다. 실제 다룰 XSD는 8MB/약 15만 라인 수준이며 더 큰 스키마도 다룰 가능성이 있다.

## 플랫폼 및 스택 결정

- **Electron 채택** (Tauri 대비): 이 앱은 캔버스/그래프/트리 렌더링 품질이 핵심인데, Tauri는 OS 시스템 웹뷰(WebView2/WebKitGTK 등)를 사용해 플랫폼별 렌더링 편차가 있고 특히 Linux의 WebKitGTK는 SVG/Canvas 집약적 UI에서 취약점이 알려져 있다. Electron은 Chromium을 번들해 플랫폼 간 렌더링이 일관적이다. 또한 XSD 파싱/모델/코드생성 "코어"를 TypeScript 한 언어로 통일할 수 있어(Rust+JS IPC 경계 없이) 유지보수 부담이 적다. 번들 크기/메모리는 Tauri가 유리하지만, 개발 도구 특성상 감수 가능한 트레이드오프로 판단.
- **프론트엔드**: React + TypeScript. 트리는 `react-arborist`(가상화, 드래그앤드롭, 인라인 rename 지원), 참조 그래프는 `@xyflow/react`(React Flow, 커스텀 노드/엣지, 미니맵, 클릭 네비게이션). 상태관리는 Zustand(정규화된 엔티티 맵 + undo/redo 미들웨어에 적합, Redux보다 가벼움). 코드/XML 뷰어는 Monaco Editor.
- **코어 엔진**: `packages/core`라는 순수 TypeScript 패키지로 분리, Electron/DOM 의존성 없이 Node/Vitest로 단독 테스트 가능하게 만든다. XML 파싱은 DOM 기반(`@xmldom/xmldom`)을 사용해 라운드트립(주석/포맷 보존)이 가능하도록 한다 — 내부 모델은 "라이브 DOM 위의 파사드"로 설계해, 편집 시 원본 DOM을 부분적으로만 수정하고 새로 생성된 노드만 새로 합성한다.

## 핵심 모듈 구조 (`packages/core`)

1. **parser/** — XSD 로더: 단일 파일뿐 아니라 `xs:import`/`xs:include`를 재귀적으로 해석해 다중 파일 `SchemaSet` 구성. 네임스페이스/QName 해석은 `qnameResolver.ts`에 집중화. DOM→모델 변환 시 원본 DOM 노드 위치를 `sourceRef`로 유지(라운드트립용).
2. **model/** — 정규화된 엔티티 그래프(`Record<NodeId, SchemaNode>` + 인덱스). `ElementDecl`, `ComplexTypeDecl`, `SimpleTypeDecl`, `GroupDecl`, `AttributeDecl`, `QNameRef`(참조값 객체, `resolvedTargetId` 보유) 등 타입 정의. CRUD는 `schemaModel.ts`가 담당하며 변경 이벤트를 발행.
3. **resolver/** — 모든 QName 참조를 해석해 의존성 그래프(타입 참조/확장/제한/그룹참조/substitution) 구축. `getReferencesFrom/To`, `getExtensionChain` 등 조회 API 제공. 편집 시 영향받은 노드만 부분 재계산(전체 재스캔 방지).
4. **serializer/** — 모델→XSD 직렬화. **DOM 패치 전략**: 변경된 필드만 원본 DOM에 부분 반영(`domPatcher.ts`)하고, 신규 생성 노드만 새로 합성(`domSynth.ts`)하여 주석/포맷을 최대한 보존.
5. **codegen/** — **플러그인 계약** `ICodeGenerator { id, displayName, generate(model, options): GeneratedFile[], getOptionsSchema(), validateModelSupport? }`을 정의하고 `registry.ts`에 등록. 새 언어 추가 시 `generators/<lang>/`에 클래스 하나 추가 + `builtins.ts`에 import 한 줄만 필요(코어 변경 불필요) — 이것이 "모듈식 확장성" 요구사항을 충족시키는 지점. 텍스트 생성은 Handlebars 템플릿 + 언어 독립적 "codegen IR"(`ir.ts`)을 매개로 한다.
   - **C/C++ 생성기**: complexType→struct(또는 옵션에 따라 class), enumeration facet→enum, occurrence>1→고정배열 또는 count+동적배열. 헤더/소스 분리, 초기/해제 함수 생성. 직렬화 코드는 옵션으로(스텁 또는 향후 libxml2 연동).
   - **Python 생성기**: complexType→`@dataclass`(기본) 또는 Pydantic `BaseModel`(옵션, facet→Field validator 매핑에 유리), enumeration→`enum.Enum`.
   - 두 생성기는 `naming.ts`(식별자 변환)와 `typeMapping.ts`(XSD 내장타입→네이티브 타입)를 공유.
6. **validation/** — 구조 규칙(필수 필드, dangling 참조, 순환 상속, xs:all 제약 등)과 facet 유효성 검사. 편집 시 증분 검사(즉시 UI 피드백) + Save/Generate 전 전체 검사.
7. **commands/** — 모든 편집은 Command 패턴(`RenameNodeCommand`, `SetFacetCommand`, `ChangeTypeRefCommand`, `MoveNodeCommand`, `AddChildCommand`, `DeleteNodeCommand`)으로 표현되어 undo/redo와 직렬화 패처가 동일한 최소 diff 정보를 공유.

## UI 제안

**메인 창 레이아웃** (리사이즈 가능한 분할 패널):

- **상단**: 메뉴바(File: Open/Save/Export XSD, Edit: Undo/Redo, View: Tree/Graph 토글, Generate: 코드 생성) + 아이콘 툴바 + 전역 검색(이름으로 요소/타입 찾기).
- **좌측 패널 — 트리뷰**: 파일 단위로 그룹화된 계층 트리. 노드 종류별 아이콘 + cardinality 배지(`1..*` 등). 더블클릭/F2로 인라인 이름 편집, 드래그앤드롭으로 재정렬/이동(XSD상 불가능한 위치는 드롭 금지 표시). 우클릭 메뉴: 자식 추가, 삭제, "참조 찾기"(그래프뷰로 포커스 이동), "정의로 이동"(참조 노드 클릭 시 실제 타입 정의로 점프).
- **중앙 패널 — 탭 전환**:
  - "다이어그램" 탭: 선택된 노드의 로컬 구조(시퀀스/선택 트리)를 박스-커넥터 형태로 시각화.
  - "참조 그래프" 탭(React Flow): 전체 타입/요소/그룹을 노드로, 관계 종류별로 엣지 스타일 구분(확장=실선 화살표, 제한=점선, 타입참조=얇은 화살표, substitution=점선). "포커스 모드"로 선택 노드의 직접 참조/역참조만 강조(대형 스키마 가독성 확보). 그래프↔트리 클릭 시 양방향 선택 동기화.
  - "XML 소스" 탭(선택): 선택 노드에 대응하는 원본 XSD 조각을 Monaco로 읽기 전용 표시.
- **우측 패널 — 속성 인스펙터**: 선택 노드 종류에 따라 동적 폼.
  - 공통: 이름, 문서화(annotation).
  - Element: 타입(검색 가능한 드롭다운, 다른 타입 선택 시 참조 재연결), minOccurs/maxOccurs(unbounded 체크박스), nillable, default/fixed, abstract, substitutionGroup.
  - ComplexType: abstract, mixed, 기반 타입(extension/restriction 라디오). 자식 요소 구조 자체는 트리/다이어그램에서 편집(속성 패널과 역할 중복 방지).
  - SimpleType: 기반 타입 + **facet 편집기**(enumeration 목록 add/remove, pattern, min/maxLength, min/maxInclusive 등 — 기반 타입에 유효한 facet만 표시).
  - 모달이 아닌 사이드 패널로 구현(트리 탐색과 동시에 문맥 유지). 모달은 "새 타입 생성 마법사", "코드 생성" 같은 큰 동작에만 사용.
- **하단 패널(접기 가능) — 검증/진단**: 심각도별 진단 목록, 클릭 시 해당 노드로 이동. Save/코드생성 결과 로그도 여기 표시.
- **코드 생성 흐름**: 모달로 (1) 대상 언어 선택(등록된 생성기 목록에서, 다중 선택 가능) → (2) 생성기별 옵션(예: C/C++의 "C vs C++", "직렬화 스텁 포함 여부"; Python의 "dataclass vs Pydantic") → (3) 출력 디렉토리 선택 → (4) 생성 실행 및 결과/경고 리포트.

## 데이터 흐름 / 상태관리

단일 진실 소스는 Zustand 스토어가 감싸는 `SchemaModel`. 모든 편집은 Command로 dispatch되어 undo/redo 스택(전체 스냅샷이 아닌 command 역연산 방식)에 쌓이고, 텍스트 필드 편집은 blur/디바운스 시점에 하나의 command로 병합한다. 선택 상태(`selectedNodeId`)를 스토어에 두어 트리/그래프/인스펙터 3패널이 자연스럽게 동기화된다. Electron에서는 파일 I/O(열기/저장/코드출력)만 `preload.ts`를 통해 메인 프로세스로 IPC하고, 파싱/모델/코드생성 로직은 렌더러(또는 대형 스키마 대응을 위한 Web Worker)에서 수행한다.

## 프로젝트 구조

```
xsd-visualizer/
  packages/core/            # UI 비의존 엔진 (parser, model, resolver, serializer, codegen, validation, commands)
    src/{parser,model,resolver,serializer,codegen,validation,commands}/
    test/                   # Vitest 단위/라운드트립/코드생성 스냅샷 테스트
    fixtures/               # 샘플 XSD (imports, includes, substitution groups, 대형 스키마 등)
  apps/desktop/              # Electron + React 앱
    electron/{main.ts, preload.ts, menu.ts}
    src/{state, components/{TreeView,GraphView,LocalDiagram,PropertyPanel,ValidationPanel,CodegenDialog}}
  apps/cli/                  # (후반 단계, 선택) packages/core 재사용 헤드리스 코드생성 CLI
```

## 단계별 진행 계획

1. **Phase 0**: 모노레포 스캐폴딩(pnpm workspace), `packages/core` 빌드/테스트 환경, `apps/desktop` Electron+React+Vite 스캐폴드. 8MB/15만 라인급 실제 스키마(또는 동등 규모의 합성 픽스처)를 `large-schema.xsd`로 미리 확보. **(완료)**
2. **Phase 1 (MVP)**: 단일 파일 XSD 파싱(Web Worker에서 실행) → 읽기 전용 트리뷰(react-arborist 가상화) + 읽기 전용 속성 표시. 검수 기준: `large-schema.xsd` 로드 시 초기 렌더링이 화면 노드 수에 비례해 체감 지연 없이 완료되는지 측정. **(완료 — 실측: 8.00MB/163,543줄 합성 픽스처 기준 파싱 137,713개 노드에 약 2.6초, 힙 메모리 증가분 약 83MB, RSS 약 388MB. Worker에서 실행되어 파싱 중에도 UI가 멈추지 않고 "파싱 중..." 상태를 표시하며, react-arborist 가상화로 8,600여 개 최상위 타입에서도 스크롤이 즉각적임을 브라우저로 확인. 지연 로딩은 파싱 자체는 Worker에서 전체를 한 번에 수행하고 렌더링만 가상화하는 방식으로 단순화 — 2.6초가 병목으로 확인되면 Phase 6에서 증분/스트리밍 파싱 재검토.)**
3. **Phase 2**: 다중 파일(import/include) 지원, resolver로 의존성 그래프 구축(증분 재계산 기본 설계), 참조 그래프 UI(React Flow, 기본 포커스 모드) + 트리↔그래프 동기화. 검수 기준: `large-schema.xsd`에서 포커스 모드 그래프 탐색이 매끄러운지 측정. **(완료 — Electron IPC로 실제 xs:import/xs:include 다중 파일 로딩 구현(브라우저 탭에서는 단일 파일로 폴백), resolver 모듈로 참조/역참조 그래프 구축, React Flow 포커스 모드 그래프 + 트리↔그래프 양방향 선택 동기화를 브라우저로 실제 확인.)**
4. **Phase 3**: Command/undo-redo 인프라, 트리 편집(rename/추가/삭제/이동), 속성 패널 전체 필드 편집, facet 편집기, 검증. 검수 기준: `large-schema.xsd`에서 필드 하나 수정 시 UI 반응 지연 측정. **(완료 — validateModel(24ms)/buildDependencyGraph(32ms)가 137,713개 노드 기준으로도 충분히 빨라 "전체 재검증"으로 확정(증분 검증 불필요, 계획 대비 단순화). Command 기반 undo/redo, 속성 패널 전체 필드 편집(텍스트/체크박스/occurs/타입 재연결/facet 편집기), 트리 인라인 rename, 우클릭 요소·속성 추가/삭제를 브라우저로 실제 확인. 검증 중 `SchemaModel.updateNode/removeNode`가 QName 인덱스를 갱신하지 않는 버그를 발견해 수정(회귀 테스트 추가) — 이름 변경/삭제 후 참조 해석이 정확해짐. 최상위 선언(문서 직속 element/complexType 등) 추가/삭제는 이번 범위에서 제외.)**
5. **Phase 4**: DOM 패치 기반 직렬화기, 라운드트립 신뢰성 회귀 테스트(파싱→편집→직렬화→diff), Save/Export 연동. **(완료 — `serializer/`(domPatcher, domSynth, qnameSerializer, xsdWriter) 구현. 원본 파일을 매 저장 시 새로 파싱해 `sourceRef.path`로 위치를 찾고, 구조가 바뀐 컨테이너만 재생성(변경 없는 영역은 주석/들여쓰기까지 그대로 보존)하는 방식. 라운드트립 회귀 테스트 10개(무편집 보존, rename, facet 편집, 타입 재연결, 요소/속성 추가·삭제, 실제 fixture 파일의 extension/choice/group ref 보존) 전부 통과. 검증 중 "구조 미변경 시 개별 필드 패치까지 통째로 건너뛰는" 버그를 발견해 수정. Electron에 파일쓰기 IPC(`writeTextFile`) 추가, Save를 Web Worker로 라우팅해 UI 스레드 비차단, 브라우저 탭 폴백은 다운로드로 처리. 8MB/137,713개 노드 기준 저장(재파싱+패치+직렬화) 약 576ms로 충분히 빠름. 알려진 제약: 한 태그 내부의 속성 줄바꿈/공백은 DOM 정보모델 특성상 보존 안 됨(서식만의 차이, 데이터 손실 아님), 최상위 선언 추가/삭제는 Phase 3와 마찬가지로 범위 밖.)**
6. **Phase 5**: 코드생성 플러그인 인터페이스+레지스트리+IR, C/C++ 생성기, Python 생성기, 코드생성 다이얼로그 UI. 검수 기준: 생성된 C 코드는 CI에서 실제 컴파일, Python 코드는 실제 import 검증. **(완료 — `codegen/`(types.ts의 `ICodeGenerator` 플러그인 계약, registry.ts, ir.ts의 언어 독립 IR, naming.ts, typeMapping.ts) + C/C++·Python 생성기 + `builtins.ts` 자동 등록 구현. IR은 sequence/choice/xs:all과 group ref를 하나의 필드 목록으로 평탄화하며, xs:choice 하위나 minOccurs=0인 그룹/컴포지터에 속한 필드는 강제로 optional 처리(다단계 occurs 곱셈까지는 반영하지 않는 단순화, 문서화됨). C 생성기는 struct/enum/init·free 함수를 생성하고, DFS로 struct 간 값-임베드 그래프의 사이클(자기참조·상호재귀 타입)을 탐지해 해당 필드만 포인터로 전환해 유한 크기를 보장하며 나머지는 의존성 순서로 정렬 — TreeNode(자기참조) 등으로 회귀 테스트. Python 생성기는 `@dataclass`(기본)와 Pydantic `BaseModel`(옵션) 두 스타일을 지원하고 enumeration facet은 `class X(str, Enum)`으로 매핑; 데이터클래스 다중상속 시 "기본값 없는 인자가 기본값 있는 인자 뒤에 올 수 없음" 오류를 원천 차단하기 위해 모든 필드를 Optional/기본값 처리하고 원래의 필수 여부는 `# required` 주석으로만 보존(문서화된 단순화). Toolbar의 "Generate Code" 버튼과 CodegenDialog(언어 선택, 옵션 폼, 경고 목록, Electron 디렉토리 선택 다이얼로그 또는 브라우저 개별 다운로드, 결과 로그)를 연결. **검수 기준 검증 완료**: 사용자가 MinGW GCC 6.3.0을 설치한 뒤, 생성된 `schema.h`/`schema.c`(단순 스키마 + extension 상속 + 배열 + 선택적 필드 조합)를 `gcc -std=c99 -Wall -Wextra`로 실제 컴파일·링크·실행해 init/free 동작(중첩 구조체·배열·문자열 재귀 해제, free 후 포인터가 NULL로 재설정됨)까지 확인했고, 자기참조(TreeNode) 스키마도 동일하게 컴파일·실행 성공, `language: "cpp"` 옵션 산출물도 `g++ -std=c++14 -Wall -Wextra`로 경고 없이 컴파일됨. Python은 pydantic 설치 후 dataclass·Pydantic 두 스타일 모두 실제 `import` 및 인스턴스 생성(상속, enum, `model_dump()`)까지 확인. CodegenDialog UI도 Chrome 브라우저 자동화로 실제 클릭 테스트: XSD 업로드 → 언어 전환(C/C++ ↔ Python, 옵션 폼이 즉시 재렌더링됨) → 경고 없음 확인 → Generate 클릭 → 브라우저 폴백 다운로드로 정확한 `schema.py` 내용(1126바이트)이 실제 전달됨을 확인(Chrome이 `.py` 확장자를 보안상 보류하는 것은 브라우저 자체의 다운로드 정책이며 Electron 모드는 IPC로 직접 파일에 쓰므로 해당 없음).)**
7. **Phase 6**: 고급 XSD 구성(xs:any, mixed content, union/list) 처리, Phase 1~3에서 확보한 성능 기준선을 넘는 초대형 스키마 대응 추가 튜닝, 패키징(electron-builder), 선택적으로 headless CLI 추가. **(완료 — headless CLI는 사용자 판단으로 이번 범위에서 제외.**
   - **고급 XSD 구성**: `model/types.ts`에 `AnyNode`(xs:any wildcard: namespace/processContents/occurs)와 `SimpleTypeDecl.variant`(`"restriction" | "list" | "union"` + `itemTypeRef`/`memberTypeRefs`)를 추가하고 parser/serializer(domPatcher의 `getOrCreateSimpleTypeVariantChild`로 변형 전환 시 기존 restriction/list/union 자식을 교체)/validation(itemType·memberTypes dangling 참조 검사, xs:all 카디널리티 검사에 xs:any 포함)/resolver(list/union 참조를 `referencesType` 엣지로)/codegen(named 또는 인라인 `xs:list` 참조는 반복 필드로 자동 변환, `xs:union`은 string으로 근사하며 경고, `mixed`/`xs:any`는 경고와 함께 필드 생성 생략)/UI(TreeView에 xs:any 렌더링과 "새 와일드카드 추가" 컨텍스트 메뉴, `AnyForm`, `SimpleTypeForm`의 종류 선택기 + list itemType/union memberTypes 편집기, complexType 트리 배지에 mixed 표시) 전 계층에 반영. 코어 단위 테스트 20개 추가(파서 4, 직렬화 3, 검증 2, codegen IR 3 등, 전체 77개 통과). Chrome 브라우저로 xs:any/list/union이 섞인 실제 스키마를 열어 트리 배지("list of string", "union(2)", "mixed") 표시, xs:any 속성 편집, union memberTypes 추가, Save 후 재직렬화된 XML까지 직접 확인(`<xs:list itemType="xs:string"/>`, `memberTypes="xs:int xs:string xs:boolean"` 등 정확히 보존/반영됨). 이로써 위 "주요 리스크"의 xs:any 관련 disclosed limitation은 해소됨(더 이상 순서가 흐트러지지 않고 정식으로 모델링/왕복됨).
   - **초대형 스키마 성능 튜닝**: 32MB/652,527줄/549,489노드 합성 스키마로 벤치마크 도구(`scripts/generate-large-fixture.mjs`, `scripts/bench-large-schema.mjs`에 사이즈/파일명 인자 및 codegen 타이밍 추가)를 확장해 실측한 결과 **파싱 시간이 파일 크기에 대해 초선형(8MB 2.6초 → 32MB 36.4초, 약 14배)으로 증가하는 실제 성능 버그를 발견**: `parser/domToModel.ts`의 `nodePath()`가 각 노드에서 루트까지 올라가며 매번 `Array.prototype.indexOf.call(parent.childNodes, node)`를 호출하는데, `<xs:schema>` 루트처럼 자식이 수만 개인 부모에 대해 이 인덱스 탐색이 자식마다 반복되어 전체적으로 O(n²)이 되는 것이 원인. 부모별 자식→인덱스 `Map`을 최초 조회 시 한 번만 만들어 재사용하는 캐시(`indexOfChild`)로 교체해 O(n)으로 개선 — 수정 후 실측: 8MB 파싱 2.6초→0.51초(약 5배), 32MB 파싱 36.4초→2.1초(약 17배), 두 지점 모두 파일 크기에 선형에 가깝게 스케일링됨을 확인(회귀 없음, 코어 테스트 77개 전부 통과). 검증/의존성그래프/직렬화/codegen 시간도 32MB 기준 각각 104ms/119ms/2.2초/0.4~0.7초로 사용자가 체감할 수준이 아님을 확인. 메모리는 32MB 입력 기준 힙 증가분 약 494MB(입력 대비 약 15배)로, 기존 문서의 "5~10배" 추정보다 다소 높게 실측되어 이 문서의 추정치를 갱신함(아래 "성능 목표" 절 참고).
   - **electron-builder 패키징**: `apps/desktop/package.json`에 `electron-builder` devDependency와 `build` 설정(appId, productName, `files: [dist, dist-electron, package.json]`— 렌더러/메인 프로세스 모두 런타임에 `@xsd-visualizer/core`나 다른 node_modules를 필요로 하지 않아 별도 워크스페이스 심볼릭 링크 처리 없이 가장 단순한 구성으로 충분함, `win.target: ["nsis", "portable"]`) 및 `package`/`package:win` 스크립트 추가. **실제 빌드 검증**: `npm run package:win` 실행 결과 `release/win-unpacked/XSD Visualizer.exe`, NSIS 설치 파일(`XSD Visualizer Setup 0.0.0.exe`, 약 84MB), 포터블 단일 실행 파일(`XSD Visualizer 0.0.0.exe`, 약 84MB)이 모두 정상 생성됨을 확인. 최초 시도 시 NSIS/portable 타깃이 요구하는 `winCodeSign` 보조 도구 압축 해제가 Windows의 일반 사용자 심볼릭 링크 생성 제한으로 실패했으나, 사용자가 Windows 개발자 모드를 켠 뒤 재시도해 해결(서명 자체와는 무관한 환경 이슈). 포터블 exe를 실제로 실행해 프로세스가 정상 유지되고 "XSD Visualizer" 타이틀의 실제 창이 뜨는 것까지 확인(Electron 네이티브 창이라 화면 내용까지는 이 세션에서 스크린샷으로 볼 수 없다는 기존 제약은 동일). 앱 아이콘은 별도로 준비하지 않아 Electron 기본 아이콘이 사용됨(원하면 추후 `.ico`/`.icns` 추가 가능) — 코드사인 인증서도 없어 설치 파일은 서명되지 않은 상태(배포 시 SmartScreen 경고가 뜰 수 있음, 별도 인증서 구매 시 해결 가능).)**

## 성능 목표 및 다중 파일 병합 범위

- **실제 목표 규모**: 사용자가 다룰 대상은 8MB/약 15만 라인 수준이며, 향후 더 큰 스키마도 다룰 가능성이 있다. 이는 앞서 추정한 구간 중 "5~20MB(수만~10만 노드, 파싱/검증에 수 초 소요 가능)"에 해당하므로, **성능 관련 설계를 Phase 6 하드닝 단계로 미루지 않고 Phase 1~2 기본 아키텍처에 포함**시킨다:
  - **파싱/resolve/validation을 처음부터 Web Worker에서 실행** (렌더러 메인 스레드는 UI만 담당, Phase 6의 "필요시 워커 분리"가 아니라 Phase 1부터 기본값).
  - **트리는 처음부터 지연 로딩**: 최상위/가시 영역 노드만 우선 파싱·렌더링하고, 자식 노드는 펼칠 때(on-demand) 모델을 구체화. `react-arborist`의 가상화와 결합해 초기 로드 시간을 파일 크기가 아니라 화면에 보이는 노드 수에 비례하게 만든다.
  - **참조 그래프는 기본이 포커스 모드**(선택 노드 주변만 렌더링)이고 "전체 그래프 보기"는 명시적 옵트인 + 저zoom 클러스터링으로 제공.
  - **증분 재계산**(resolver/validation)은 Phase 2/3 설계 단계부터 필수 요구사항으로 취급(엣지 케이스 최적화가 아니라 기본 동작).
  - DOM 기반 파싱 특성상 메모리 사용량은 원본 파일 크기 대비 일정 배수로 늘어날 것으로 예상. Phase 1 완료 시점에 8MB/15만 라인 규모의 실제(또는 유사) 스키마를 `large-schema.xsd` 픽스처로 확보해 로드 시간·메모리·조작 반응성을 측정하고, 이후 단계 진행 여부의 기준선으로 삼는다. **(Phase 6에서 32MB 픽스처로 재측정: 힙 증가분이 입력 파일 크기의 약 15배 — 8MB 기준 추정했던 "5~10배"보다 다소 높게 실측됨. 32MB/549,489노드 기준 RSS 약 2.1GB, 힙 증가분 약 494MB로, 사용자의 실제 목표 규모(8MB)에서는 여유가 충분하나 이보다 몇 배 더 큰 스키마를 다룰 계획이면 이 비율을 기준으로 메모리를 가늠할 것.)**
- **다중 파일 병합 범위**: `xs:import`/`xs:include`로 이미 연결된 파일들을 하나의 스키마 셋으로 불러와 통합된 트리/참조 그래프로 보여주고, 저장 시에는 원래 파일 경계를 유지해 각 파일에 다시 쓰는 것을 기본 지원 범위로 한다(2.1 parser, 2.4 serializer에 이미 반영됨). 서로 연결되지 않은 독립 파일들을 인위적으로 한 작업공간에 모아 참조시키는 기능이나, 여러 파일을 물리적으로 하나의 XSD로 합쳐 내보내는 별도 병합 시리얼라이저는 이번 범위에서 제외한다(향후 필요 시 추가 검토).

## 주요 리스크

- **XSD 스펙 복잡도**: substitution group, abstract, wildcard(xs:any), mixed content, xs:redefine 등 전부 동일 수준으로 지원하기 어려움 → v1에서 "완전 편집 지원" 대상과 "보존만 하고 읽기전용" 대상을 명시적으로 구분해 UI에 표시. **(Phase 6에서 wildcard(xs:any)·mixed content·union/list simpleType을 편집 가능한 수준으로 모델링 완료. xs:redefine/xs:override/xs:notation, 인라인(익명) list/union item·member 타입은 여전히 범위 밖.)**
- **라운드트립 신뢰성**: 전체 재생성 방식은 주석/포맷을 잃음 → DOM 부분 패치 전략을 채택하되, diff 기반 회귀 테스트로 신뢰성을 측정 가능한 지표로 관리. **(Phase 4에서 구현/실측)** 편집되지 않은 영역은 주석·들여쓰기가 그대로 보존됨을 회귀 테스트로 확인. 단, DOM의 정보 모델 특성상 **하나의 태그 내부의 속성 줄바꿈/공백은 보존되지 않음**(예: 여러 줄에 걸쳐 쓰인 `<xs:schema xmlns:xs="..."\n  xmlns:tns="...">` 는 저장 후 한 줄로 합쳐짐, 루트 종료 태그 뒤 마지막 줄바꿈도 보존 안 됨) — 이는 데이터 손실이 아니라 서식만의 차이이며, xmldom 등 DOM 파서의 공통적인 한계로 받아들이기로 함. `xs:any`(wildcard)는 Phase 6에서 정식 모델링되어(`AnyNode`) 다른 구조 편집과 마찬가지로 위치가 안정적으로 보존됨 — 더 이상 disclosed limitation 아님.
- **C/C++ 코드 생성의 정합성**: 임의의 XSD 구조가 항상 깔끔한 struct로 매핑되지 않음(재귀 타입, 가변 길이 등) → 초기 지원 범위를 문서화하고, 지원 불가 구성은 `validateModelSupport()` 경고로 표시, CI에서 실제 컴파일 검증.
- **대형 스키마 성능**: 수천 개 노드 스키마에서 트리/그래프가 느려질 수 있음 → 가상화 트리, 그래프 "포커스 모드", 증분 재계산 설계를 초기 단계부터 반영. **(Phase 6에서 32MB/549,489노드 규모로 실측 중 파싱이 파일 크기에 초선형(O(n²))으로 느려지는 실제 버그를 발견해 수정 — 자세한 내용은 위 Phase 6 항목 참고. 수정 후 파싱·검증·의존성그래프·직렬화·codegen 모두 파일 크기에 선형에 가깝게 스케일링됨을 확인.)**

## 검증 방법

- `packages/core`는 Vitest로 파서/모델/resolver/serializer/codegen/validation 각각 단위 테스트, 특히 serializer는 실제 XSD 샘플에 대한 파싱→편집→직렬화→원본 diff 회귀 테스트로 라운드트립 검증.
- 코드생성기는 스냅샷 테스트 + CI에서 생성된 C 코드를 실제로 컴파일(gcc/clang), 생성된 Python 코드를 실제로 import하여 동작 검증.
- `apps/desktop`은 Vitest+React Testing Library로 컴포넌트 테스트, 실제 XSD 파일을 열어 트리/그래프/편집/저장/코드생성 전체 플로우를 수동으로 실행해 골든 패스 확인.
