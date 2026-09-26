# 3MF 지원 현황

검토일: 2026-09-26. 여기서 **지원**은 타입 모델·읽기·쓰기·해당 필드의 구조 검증을 뜻합니다. 렌더링, 물리적 출력, 슬라이싱, 전체 표준 적합성 인증을 의미하지 않습니다. 확장 전체는 아래 세부 기능 중 일부만 구현되어 있으므로 **부분 지원**입니다.

공식 [스펙 목록](https://3mf.io/spec/)과 다음 고정 리비전을 기준으로 구현했습니다. 목록의 안정판 표시와 저장소 문서 헤더의 버전이 다른 경우를 구분합니다.

| 문서                                               | 구현 시 확인한 원문                                                                                                                       |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Core 1.4.0 (목록의 ISO 기준은 1.3.0)               | [997b385](https://github.com/3MFConsortium/spec_core/blob/997b385e06f3181cf9aae0c578e0b45ccd48ccb2/3MF%20Core%20Specification.md)         |
| Materials and Properties 1.2.1                     | [d4d42dd](https://github.com/3MFConsortium/spec_materials/blob/d4d42dd75ca07da40284dc87e3204b2993d2f862/3MF%20Materials%20Extension.md)   |
| Production 저장소 헤더 1.2 (목록의 안정판은 1.1.2) | [e7b7a5a](https://github.com/3MFConsortium/spec_production/blob/e7b7a5ab7051d1957789ff849233c1a731f1d38f/3MF%20Production%20Extension.md) |

| 범위               | 기능                                                         | 읽기                   | 쓰기        | 검증/제약                                                                                   |
| ------------------ | ------------------------------------------------------------ | ---------------------- | ----------- | ------------------------------------------------------------------------------------------- |
| Core §2, OPC       | ZIP32 store/deflate, content types, root/part relationships  | 지원                   | 지원        | CRC, 중복 경로, 경로 탈출, 참조, 크기 제한. ZIP64/분할/암호화 ZIP 미지원                    |
| Core §3            | 6종 단위, xml:lang, 12수 affine transform                    | 지원                   | 지원        | 유한 수·가역성. 단위 자동 변환 없음                                                         |
| Core §3.4          | 모델 메타데이터, preserve/type, object/item metadatagroup    | 지원                   | 지원        | 표준 이름/네임스페이스 선언·중복 확인. metadata type 값의 XSD 타입별 내용 검증은 미지원     |
| Core §3.4          | resources/build, 복수 인스턴스, partnumber                   | 지원                   | 지원        | 모델별 ID, 대상 종류, 참조 유효성                                                           |
| Core §4            | mesh, 5종 object type, components                            | 지원                   | 지원        | 인덱스, 유한 좌표, 기본 topology 선택 검증, 모든 리소스 참조 순서·순환                      |
| Core §4            | 삼각형별 pid/p1/p2/p3와 객체 기본값                          | 지원                   | 지원        | 그룹/인덱스 검증 및 상속 조회. 실제 보간·렌더링 없음                                        |
| Core §4            | manifold edge/인접 방향                                      | 선택 검증              | 선택 검증   | `{topology:true}`. 밖을 향한 winding, 자체 교차, Positive fill 계산, repair는 미지원        |
| Core §5            | base materials, 이름, sRGB/RGBA                              | 지원                   | 지원        | 색상 형식, 속성 인덱스, base material gradient 금지                                         |
| Core §6            | 패키지/객체 thumbnail, custom attachment, MustPreserve       | 지원                   | 지원        | 첨부 바이트·MIME·relationships 보존. 이미지 디코딩/재생성 없음                              |
| Core §6            | OPC core properties                                          | 원본 보존              | 첨부 가능   | typed 편집 API 없음                                                                         |
| Core §6            | digital signatures/protected content                         | 미지원                 | 미지원      | 서명 관계/서명 content type 발견 시 거부. 검증·재서명·암복호화 없음                         |
| Core Appendix B.1  | Triangle Sets                                                | 미지원                 | 미지원      | 해당 XML 발견 시 명시적 오류                                                                |
| Materials §2       | colorgroup                                                   | 지원                   | 지원        | 색상/색상 인덱스                                                                            |
| Materials §3, §6   | texture2d, texture2dgroup, UV, tile/filter                   | 지원                   | 지원        | 리소스·첨부 참조. PNG/JPEG 바이트 디코딩 및 렌더링 없음                                     |
| Materials §4       | compositematerials                                           | 지원                   | 지원        | 2개 이상 base 재질 참조, [0,1] 가중치. 누락값 0·추가값 무시·정규화·합 0 균등 배분 조회 지원 |
| Materials §5       | multiproperties, blendmethods                                | 지원                   | 지원        | 그룹 조합·순서·속성 인덱스, 누락 인덱스 0. 실제 색상 blend 미지원                           |
| Materials §7       | PBR specular/metallic/texture/translucent display properties | 미지원                 | 미지원      | 해당 요소/속성 발견 시 명시적 오류                                                          |
| Production §2–4    | 복수 model part, p:path, UUID                                | 지원                   | 지원        | root만 외부 모델 참조 가능, 모든 객체/컴포넌트/item UUID 및 root build UUID                 |
| Production §4.2.2  | alternative representations/modelresolution                  | 미지원                 | 미지원      | 해당 요소/속성 발견 시 명시적 오류                                                          |
| Beam Lattice       | 전체                                                         | 미지원                 | 미지원      | 필수 확장 URI면 거부                                                                        |
| Slice              | 전체                                                         | 미지원                 | 미지원      | 필수 확장 URI면 거부                                                                        |
| Boolean Operations | 전체                                                         | 미지원                 | 미지원      | 필수 확장 URI면 거부                                                                        |
| Secure Content     | 전체                                                         | 미지원                 | 미지원      | 필수 확장 URI면 거부                                                                        |
| Volumetric         | 전체                                                         | 미지원                 | 미지원      | 필수 확장 URI면 거부                                                                        |
| Toolpath           | 전체                                                         | 미지원                 | 미지원      | 2026-09-17 목록에 추가된 확장. 필수 URI면 거부                                              |
| Bambu 비표준       | 통합/개별 profile, plate 설정/PNG, extruder, assembly        | 부분 typed + 원본 보존 | 어댑터 지원 | [세부 지원 감사](bambu-support.md). slice 결과/painting/전체 config 해석과 GUI 검증 미지원  |

## 읽기·재저장 정책

- XML namespace는 prefix 문자열이 아니라 URI로 판별합니다. 알 수 없는 `requiredextensions`는 거부합니다. 미지원 `recommendedextensions` 선언은 warning으로 반환합니다.
- 지원 확장에서도 미구현 XML 요소/속성은 `UNSUPPORTED_MARKUP` 오류입니다. 선택 확장 XML까지 보존하는 범용 XML 편집기는 아닙니다.
- 모델 이외의 첨부는 MIME과 relationships를 포함해 보존합니다. 외부 relationships는 URL만 보존하며 네트워크로 가져오지 않습니다.
- 원본 XML 공백, comments, attribute 순서, 압축 바이트는 보존하지 않습니다. 숫자는 JS double 범위로 처리하고 쓰기 시 반올림하지 않습니다.
- UTF-8 XML만 지원합니다. Node.js 22+와 최신 브라우저의 TextEncoder/TextDecoder/typed arrays가 필요합니다. 기본 UUID 생성은 secure-context Web Crypto를 요구하며 factory를 주입할 수 있습니다.
- ZIP64, 비 UTF-8 비 ASCII ZIP 이름, XML DTD/entities, streaming, async compression은 미지원입니다. 현재 ZIP/XML/geometry 전체를 메모리에 올립니다.
- `printable`은 기존 슬라이서의 비표준 build item 속성으로 읽고 쓸 수 있습니다. vendor metadata는 실제 `BambuStudio:3mfVersion`처럼 숫자로 시작하는 local key도 수용합니다. 이 호환 처리를 완전한 XSD QName 검증으로 보지 않습니다.

## 검증 근거

- Node 테스트: Core/Materials/Production 왕복, 다른 prefix/relative relationship, malformed XML/ZIP/CRC, 참조/인덱스/순환, Bambu 설정, 패키징/CLI.
- Consortium Core의 별도 작성 Metadata Example을 fixture로 읽고 수정 후 재저장합니다. 라이선스는 `tests/fixtures/CONSORTIUM-LICENSE.txt`에 보존합니다.
- 생성한 Core XML을 공식 Appendix A XSD로 검사합니다. macOS libxml2가 `maxOccurs=2147483647`을 처리하지 못하므로 테스트에서만 `unbounded`로 치환하며, 해당 수량 상한은 TS 검증기가 별도로 검사합니다. `xml:lang` import는 로컬 최소 정의로 대체합니다. 전체 Consortium conformance suite는 실행하지 않았습니다.
- Chromium에서 Node globals 없이 읽기/쓰기를 실행하고 Web Worker에서도 동일 경로를 검증합니다.
- 기존 Snowfiy의 `snowfiy-curated-16-three-plates.3mf`를 실제로 읽고 재저장한 뒤 다시 읽었습니다(2 model parts, 48 build items, 진단 오류 없음). 다른 네 프로젝트의 전체 출력 파일이나 Bambu Studio GUI 로딩은 별도 검증 대상입니다.
