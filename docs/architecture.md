# 객체 중심 구조

공개 API는 `ThreeMFDocument`, `ThreeMFModel`, resource 계층, geometry/transform 값 객체, Bambu 프로젝트 객체로 구성됩니다. 두 package entrypoint에는 독립적인 생성·읽기·쓰기 함수 export가 없습니다. `create3mf`라는 생성 동작은 `ThreeMFDocument.create3mf()`로 제공하며 결과의 document도 클래스 인스턴스입니다.

```text
package/
  domain/       문서·모델·리소스 소유권, 값 객체, 편집 메서드
  model/        생성 builder, 내부 DTO, enum, 모델 검증 실행 상태
  extensions/   ResourceCodec<T> 및 재질 codec, Production 처리
  xml/          namespace-aware XML 파서/직렬화
  opc/          ZIP/OPC part와 relationship 처리
  adapters/     Bambu 프로젝트·프로필·plate 객체 및 vendor codec
```

## 객체와 책임

| 객체                                          | 책임                                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| `ThreeMFDocument`                             | 모델/첨부/관계 소유, static 생성·읽기, 검증·쓰기 조율                         |
| `ThreeMFModel`                                | 모델 내 resource ID, 리소스 객체, build instances, metadata 관리              |
| `ResourceNode`                                | 불변 ID, snapshot 직렬화, 다형적 clone 계약                                   |
| `ObjectResourceNode`                          | 이름/종류/UUID/metadata 등 객체 공통 행위                                     |
| `MeshResource` / `ComponentsResource`         | geometry·property 편집 / component 참조 편집                                  |
| `PropertyResourceNode` 및 구체 타입           | 재질·색·좌표·복합재료·다중 속성 항목과 count/clone override                   |
| `MeshGeometry` / `Transform3D`                | 버퍼를 소유하는 불변 값, 변환·합성·좌표 적용                                  |
| `ThreeMFBuilder`                              | 요청을 모델/리소스 객체의 메서드로 조립, 재질 중복 제거, build별 binding 반환 |
| `BambuStudioProject`                          | 소유 문서와 profile/plate/object 설정을 현재 상태 기준으로 저장               |
| `BambuProfile` / `BambuPlate` / `BambuPreset` | 프로필 편집·plate 인스턴스 구성·불변 preset 값                                |
| `BambuProjectInspection`                      | 기존 문서의 지원되는 profile/plate 부분 조회. 재저장 메서드는 없음            |

## 소유권과 수명주기

Document가 Model을, Model이 Resource를 소유합니다. `addModel`/`addResource`/`addPlate`는 입력을 복사해서 채택하고 소유한 인스턴스를 반환합니다. 반환된 인스턴스의 메서드로 수정하면 해당 aggregate에 반영됩니다. 입력 객체를 나중에 수정해도 다른 aggregate가 바뀌지 않습니다.

`MeshGeometry`/`Transform3D`는 불변 값입니다. Resource의 `geometry` 조회도 독립 값이며 `replaceGeometry()`로 변경을 반영합니다. 모델 path와 resource ID는 getter만 제공합니다. 리소스 참조를 끊는 임의 identity setter는 없습니다.

`fromData`/`toData`/`clone`은 typed array·첨부 bytes까지 복사합니다. SharedArrayBuffer 기반 view도 독립 버퍼로 복사합니다. DTO는 `DocumentData` 등의 명시적 데이터 경계 타입으로 공개합니다. Worker에는 `toData()` 결과를 보내고 수신 측에서 `fromData()`로 복원합니다. 클래스 인스턴스 자체의 structured clone이 메서드를 유지한다고 가정하지 않습니다.

빈 문서와 단계적 조립을 허용합니다. 중복 ID/path는 즉시 거부하고, 전체 참조·OPC·topology는 저장 또는 명시적 검증 때 확인합니다. `withProductionUUIDs()`는 후보 문서를 완성·검증한 뒤 독립 결과를 반환하므로 실패해도 원본과 기존 model handle은 바뀌지 않습니다.

builder의 다음 `build()`는 이전 결과를 변경하지 않습니다. ID를 다시 배정하고 Production UUID를 새로 생성하므로 binding은 해당 build에만 적용됩니다. Bambu 프로젝트는 저장 때마다 현재 profile/plate 객체에서 config를 다시 생성하며, 실패한 저장이 원본 문서를 부분 수정하지 않습니다.

## 내부 다형성과 타입 검사

`ResourceCodec<T>`가 공통 namespace/XML shape/ID 검사를 수행하고 여섯 codec이 `decode`/`encode`/`count`를 override합니다. URI+local name과 resource kind로 codec을 선택하며 prefix에 의존하지 않습니다. BaseMaterials는 Core namespace 소속이고 Production은 attribute 확장으로 별도 처리합니다.

`DocumentValidator`와 `ModelValidator`는 내부 서비스입니다. 모델/리소스 인덱스·UUID·참조 그래프·진단을 실행마다 분리하고 OPC까지 검증합니다. 공개 호출은 `document.validate()`/`assertValid()`입니다. XML/ZIP의 순수 보조 함수는 내부 구현에 한정합니다.

문자열 enum과 template literal 타입은 정확한 wire 문자열과 enum 멤버를 함께 허용합니다. `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`를 활성화했습니다. 확장을 추가할 때는 DTO union, 리소스 클래스, codec, validator, 지원 표를 함께 갱신해야 합니다. 내부 codec 등록만으로 임의 XML이 지원된다고 주장하지 않습니다.
