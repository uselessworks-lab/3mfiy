# 구현 후 독립 리뷰

리뷰일: 2026-09-26. 구현과 첫 검증을 마친 후 서로 다른 두 리뷰어에게 읽기 전용 검토를 맡겼습니다. 각 지적을 수정한 뒤 두 리뷰어가 원래 재현 조건으로 다시 확인했습니다. 이는 전체 스펙 적합성 인증이나 Bambu Studio GUI 호환성 검증을 대신하지 않습니다.

## 구조 코드 리뷰

검토 범위: 레이어 경계, 도메인 타입, 표준/OPC 동작, 확장 책임, 오류/보존 정책.

| 지적                                                         | 수정                                                                       | 검증                                                        |
| ------------------------------------------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| P1: 같은 source/type/target 관계를 합치며 명시적 ID가 유실됨 | explicit relationships는 모두 보존하고 자동 생성 관계만 중복 추가하지 않음 | 첨부 XML이 사용하는 `first`/`second` 두 ID 왕복 회귀 테스트 |
| P2: component 이외의 리소스 참조 선언 순서 누락              | object/triangle pid, texid, matid, pids 모두 참조 전 선언 검사             | 각 종류의 forward reference 거부 테스트                     |
| P2: thumbnail에 text/plain 첨부 허용                         | 객체/패키지 thumbnail 및 texture 관계 대상 MIME을 PNG/JPEG로 제한          | 잘못된 MIME 진단 테스트                                     |
| 권고: relationship source 비교 일관성                        | OPC pathKey로 대소문자 정규화                                              | source 경로 case alias가 중복 관계를 만들지 않는 테스트     |

관계 처리를 `opc/relationships.ts`로 분리하고 `validate.ts` 공개 facade에서 모델/OPC를 함께 검증하도록 정리했습니다. 리뷰어는 회귀 테스트 5/5를 직접 실행해 통과를 확인했고, 재검토 범위 내 추가 blocker가 없다고 보고했습니다.

## 별도 개발자 리뷰: 사용성·확장성

검토 범위: 소비자 API/types, Node/browser 배포, 기존 다섯 exporter 적용 가능성, Bambu adapter, 새로운 확장 추가 경로, 문서와 검증 계약.

| 지적                                                       | 수정                                                  | 검증                                                                        |
| ---------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| P1: explicit relationship ID 유실                          | 구조 리뷰와 같은 원인을 수정                          | 원래 재현 코드에서 두 ID 유지                                               |
| P2: validateDocument는 성공하지만 저장 시 OPC 오류         | 공개 validator가 effective OPC relationships까지 검사 | 누락된 target을 validate 단계에서 진단                                      |
| P2: root 대소문자가 다르면 Production build UUID 생성 누락 | Production helper도 pathKey 사용                      | root 대문자 변경 후 UUID 생성/검증 통과                                     |
| 배포 검증 부족: tarball 파일 목록만 확인                   | 별도 temp consumer에 실제 tarball 설치                | 두 package export 런타임 import, NodeNext/Bundler 타입 검사, browser bundle |

리뷰어는 plain-data 모델, readonly 입력, Node/browser 독립성, Bambu 분리를 적절하다고 평가했습니다. 신규 확장은 타입·codec·validator·지원 표/fixture를 함께 수정하는 현재 정책과 일관됩니다. 수정 후 원래 재현 코드로 재검토했으며 추가 blocker를 발견하지 않았습니다.

## 최종 확인 범위

- 자동 테스트 36개 통과: 모델/재질/Production, XML/ZIP 경계, 독립 Consortium 예제 및 Core XSD, Bambu 설정, 실제 tarball 소비, CLI, 리뷰 회귀.
- TypeScript core/CLI/browser typecheck 통과.
- Chromium 및 Web Worker에서 Node globals 없이 import/export 왕복 통과.
- 기존 Snowfiy 실제 파일 읽기·재저장·다시 읽기 확인: 2개 model part, 48개 build item, 3개 vendor 첨부.
- 추가 자체 수정: OPC 예약 경로와 typed model을 가장하는 attachment content type 거부, 미지원 서명 파일의 안전하지 않은 재저장 거부, 빈 UUID 속성 거부.
- 남은 검증 범위: 전체 Consortium conformance suite, Bambu GUI 실제 로딩, 다른 네 프로젝트 전체 출력 회귀. 현재 미지원 기능은 [스펙 지원 표](spec-support.md)에 기록했습니다.

## Bambu 지원 감사 후속 리뷰

독립 리뷰에서 발견한 네 가지 경계를 수정하고 원래 재현 조건으로 재검토했습니다.

| 지적                                             | 수정                                                                         |
| ------------------------------------------------ | ---------------------------------------------------------------------------- |
| 다색 필라멘트 문자열을 단색으로 덮어 정보 유실   | 기존 단색과 일치하는 항목만 갱신하고 다색·독립 값은 보존                     |
| 중간 components 객체의 part 설정을 Studio가 무시 | 실제 참조 모델의 mesh 여부 검사; 중첩 component 설정은 명시적으로 거부       |
| 부모 없는 embedded preset을 Studio가 건너뜀      | 생성은 nonempty inherits 필수; 읽기는 기존 정보를 보존                       |
| preset 제거 후 OPC 관계가 남음                   | 제거된 preset의 source/internal target 관계 정리; 같은 경로 교체 관계는 유지 |

구조 리뷰어는 Bambu 회귀 11/11 및 원래 다색/중첩 재현을 직접 확인했습니다. 개발자 리뷰어는 inherits 조건과 관계 제거를 실행 확인했습니다. 두 리뷰어 모두 재검토 범위에서 추가 blocker를 발견하지 않았습니다. [지원 감사](bambu-support.md)에 plate·profile별 지원/미지원 및 실제 소스와 대조한 제약을 기록했습니다.

## TypeScript 구조 후속 리뷰

`ThreeMFBuilder`, `DocumentValidator`/내부 `ModelValidator`, `ResourceCodec<T>`와 여섯 codec, 문자열 enum, `noImplicitOverride`를 적용한 뒤 두 리뷰어가 다시 검토했습니다.

- 구조 리뷰어: 클래스가 실제 생성/검증 상태와 XML 처리 책임을 소유함을 확인. builder 반복 호출과 객체 추가 후 이전 결과 보존, validator 재사용, 왕복 처리 및 관련 기존 회귀 16/16 직접 통과. 추가 blocker 없음.
- 개발자 리뷰어: 이전 build의 ZIP 바이트 보존, 오류 문서 다음 정상 문서 검사 시 diagnostics 분리, codec override 경계, enum/string 상호운용 확인. 추가 blocker 없음. build 사이의 ID/UUID 안정성을 보장하지 않는다는 권고를 API 문서에 반영.
- 이 리팩터링으로 테스트 case 수는 늘리지 않았습니다. 기존 실제 tarball 소비 테스트를 class·enum API, builder 재사용, NodeNext/Bundler의 잘못된 unit 타입 거부를 확인하도록 보강했습니다. 구현 내부 메서드 호출 순서나 class 존재 여부만 검증하는 테스트는 추가하지 않았습니다.

## 공개 API OOP 전환: 최종 리뷰

이전 내부 클래스 정리에 이어 공개 함수 API를 제거했습니다. `ThreeMFDocument`/`ThreeMFModel`/resource 계층과 `BambuStudioProject`가 실제 상태·소유권·편집·저장 책임을 갖습니다. 데이터 snapshot만 `*Data` 타입으로 노출합니다. 현재 API는 [객체 구조](architecture.md)와 [패키지 예제](../package/core/README.md)를 기준으로 합니다.

| 후속 지적                                           | 수정·확인                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 반사 geometry의 체적 부호와 corner property 방향    | 음수 determinant에서 winding 및 p2/p3 교환, 생략값 상속 유지                                                             |
| addResource가 입력 subclass를 반환한다고 잘못 보장  | add/replaceResource 반환 타입을 clone()의 실제 반환 계약에 연결; 실제 패키지 TS 검사에서 잘못된 subclass 메서드 거부     |
| SharedArrayBuffer가 structuredClone 이후에도 공유됨 | 공통 snapshot 경계에서 SAB view를 독립 버퍼로 복사. geometry·attachment·plate thumbnail의 원본/snapshot 수정 독립성 확인 |
| toData의 JSON 교환 약속이 typed array와 불일치      | structured-clone/Worker용으로 명시. JSON-safe 인코딩은 별도이며 미제공                                                   |
| 객체 편집을 되돌리거나 이동할 메서드 부족           | model.replaceResource/removeBuildItem, plate.removeInstance/replaceInstances 제공                                        |

구조 리뷰어는 원래 재현 및 관련 21개 기존 테스트를 직접 실행해 통과를 확인했습니다. 개발자 리뷰어는 palette 교체·build 삭제·plate 이동 후 저장/재읽기, snapshot 복원, 패키지 subtype 타입 검사를 확인했습니다. 두 리뷰어 모두 재검토 범위에서 추가 blocker가 없다고 보고했습니다.

최종 검증: 기존 36개 테스트·core/CLI/web typecheck·실제 tarball 소비·Chromium/Worker 통과. 테스트 case 수는 늘리지 않고 기존 사례에 실제 ownership/반사/편집 회귀를 반영했습니다. OOP API로 실제 Snowfiy 3-plate/48-instance 파일을 읽기·재저장하고 Formify X2D 569-key profile 값을 그대로 보존하는 export/import도 확인했습니다. Bambu Studio GUI 실행 검증은 수행하지 않았습니다.

## GitHub / npm 공개 준비 리뷰

svgify와 같은 root Git-install package + `package/core` npm target 구성을 적용한 뒤 두 리뷰어가 package boundary·manifest/lockfile·CI·README·MIT 고지를 검토했습니다. 두 리뷰어 모두 blocker를 발견하지 않았습니다. npm README의 지원 문서 경로는 패키지만 설치한 소비자도 볼 수 있도록 GitHub 링크로 정리했습니다.

검증한 범위:

- 기존 package-consumer case에서 root/core 두 tarball을 각각 별도 소비 프로젝트에 설치하고, 두 entrypoint·NodeNext/Bundler 타입·browser bundle을 확인했습니다. 전체 기존 36개 case 통과.
- 빌드 파일 없는 임시 Git source repository를 실제 `npm install git+file://...`로 설치했습니다. prepare 빌드, runtime dependencies 설치, core/Bambu import 및 3MF 왕복이 통과했습니다.
- 두 archive의 source map 30개가 모두 포함된 원본 source로 연결되며, generated files는 Git에서 제외됩니다.
- Git 저장소는 main/origin을 로컬 설정했습니다. 원격 repository 생성, 첫 commit/push, npm registry publication은 수행하지 않았습니다. CI workflow는 준비되었으며 GitHub에서 실행한 결과를 주장하지 않습니다.

prepare/workspace 변경 시 실제 Git dependency 설치를 다시 확인하도록 배포 안내에 기록했습니다.
