# Bambu Studio 지원 감사

검토일: 2026-09-26. 표준 3MF와 Bambu 프로젝트 형식은 별개입니다. 이 어댑터는 **슬라이싱 전 편집용 프로젝트 생성**을 지원하며, Studio가 저장하는 모든 데이터를 이해하거나 슬라이싱 결과를 생성하는 기능은 아닙니다.

이번 점검에서는 로컬 Bambu Studio의 `src/libslic3r/Format/bbs_3mf.cpp/.hpp`, `Config.cpp`, `PresetBundle.cpp`, `Preset.cpp`, `Model.cpp`, `GUI/Widgets/FilamentBitmapUtils.cpp`를 읽고, Formify/Runify/Spookify/Snowfiy/Flexify의 exporter와 대조했습니다. 공개 참고 원문은 [Bambu Studio importer/exporter](https://github.com/bambulab/BambuStudio/blob/master/src/libslic3r/Format/bbs_3mf.cpp), [configuration serialization](https://github.com/bambulab/BambuStudio/blob/master/src/libslic3r/Config.cpp), [preset bundle](https://github.com/bambulab/BambuStudio/blob/master/src/libslic3r/PresetBundle.cpp)입니다. 로컬 Studio 소스는 커스텀 변경이 포함된 체크아웃이므로 공개 master와 버전별 차이가 있을 수 있습니다.

## 발견하고 보완한 누락

| 기존 상태                                                                         | 보완                                                                                                                                         |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `createAssembly`라는 이름이 문서 생성 API의 역할보다 좁음                         | `create3mf` 및 `Create3mfPart/Object/Options/Result`로 변경. 아직 미배포이므로 이전 이름 alias를 남기지 않음                                 |
| project settings를 임의 JSON으로 받아 Studio가 무시하는 number/bool/object도 통과 | `BambuConfig`를 string 또는 string[] wire 타입으로 한정. 숫자·bool은 `"220"`, `"1"`처럼 직렬화해서 전달                                      |
| 개별 프린터·공정·필라멘트 프리셋 생성 API 없음                                    | `embeddedPresets`와 `BambuStudioProject.inspect().profile/presets` 추가, 타입별 파일 번호·설정 ID·name/from/version/inherits·중복 검사       |
| plate 이름·lock·객체 목록만 지원                                                  | plate별 bed type, print sequence, spiral mode, filament mapping, layer sequence, PNG thumbnail 및 `BambuStudioProject.inspect().plates` 추가 |
| sparse plate ID를 허용해 Studio의 id-1 배열 접근과 불일치                         | 1..N 연속 ID 검사. 빈 plate 및 같은 객체의 복수 인스턴스 지원                                                                                |
| single-part 객체에 part extruder만 쓰면 Studio가 삭제하고 object slot 1로 변경    | 해당 슬롯을 object extruder에도 기록. 서로 다른 값이 명시되면 오류                                                                           |
| 존재하지 않는 filament slot 허용                                                  | object/part 슬롯 상한 검사. slot 번호와 physical nozzle 번호를 구분                                                                          |
| 배열 크기에 대한 명시적 정책 부족                                                 | identity/color 벡터만 slot 수에 맞추고 variant/self-index/nozzle/flush 데이터는 원형 보존. 변경이 필요한 프로필은 호출자가 준비              |

## 세부 지원 표

| 기능                                                                                                                | 읽기                                           | 생성/변경               | 범위·제약                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 통합 `project_settings.config`                                                                                      | `BambuStudioProject.inspect().profile/presets` | 지원                    | printer/process/filament를 합친 호출자 소유 설정. 임의 vendor key 보존, 문자열 wire 타입 검사                                                     |
| `process_settings_N.config`                                                                                         | 지원                                           | 지원                    | `print_settings_id`가 preset 이름. 별도 1-based 파일 카운터                                                                                       |
| `filament_settings_N.config`                                                                                        | 지원                                           | 지원                    | `filament_settings_id: [name]`. 파일 번호는 filament slot 번호와 무관                                                                             |
| `machine_settings_N.config`                                                                                         | 지원                                           | 지원                    | `printer_settings_id`가 preset 이름                                                                                                               |
| preset inheritance 및 시스템 프로필 검색                                                                            | `inherits` 값 보존                             | 해석/다운로드 미지원    | 부모가 설치되지 않았거나 같은 이름의 preset이 이미 있으면 Studio가 embedded preset을 건너뛸 수 있음. 자립 프로필 보장 아님                        |
| legacy `print_setting_*.config`/INI profile                                                                         | 원본 바이트 보존                               | typed API 미지원        | 현대 JSON preset 경로만 typed 처리                                                                                                                |
| 여러 plate, 이름, 잠금, 빈 plate                                                                                    | `BambuStudioProject.inspect().plates`          | 지원                    | ID 1..N. `instanceId`는 object별 0-based, `identifyId`는 고유 정수                                                                                |
| plate별 bed/print sequence/spiral                                                                                   | 지원                                           | 지원                    | `bed_type`, `print_sequence`, `spiral_mode`로 저장. bed enum 문자열의 Studio 버전 호환성은 호출자 책임                                            |
| plate별 filament/nozzle mapping                                                                                     | 지원                                           | 지원                    | `filamentMapMode`가 있어야 mapping override 유효. `filamentMaps`는 1-based physical extruder, `filamentVolumeMaps`는 0/1                          |
| 첫/후속 layer sequence                                                                                              | 지원                                           | 지원                    | integer 리스트와 vendor range encoding. 자동 sequence 계획은 미지원                                                                               |
| plate PNG thumbnail                                                                                                 | 지원                                           | 삽입 지원               | caller-rendered PNG bytes, signature 검사. `/Metadata/plate_N.png`; 첫 preview는 package thumbnail 관계 추가                                      |
| plate 배치/좌표/bed fit/packing                                                                                     | 모델 transform으로 읽기                        | 자동 계산 미지원        | `create3mf`의 object transform을 명시. 단순 plate grouping이 좌표를 옮기지는 않음                                                                 |
| object/part 이름·extruder·local settings                                                                            | generic import 시 XML 원본 보존                | 지원                    | 직접 mesh component만 part 설정 가능; 중첩 component 설정은 오류. single-part slot 승계, 범위 검사. `settings`의 이미 직렬화된 vendor 옵션도 허용 |
| part subtype                                                                                                        | XML 원본 보존                                  | 지원                    | normal/negative/modifier/support enforcer/blocker. 비표준 의미를 일반 Core consumer에 보장하지 않음                                               |
| assemble view transform/offset                                                                                      | XML 원본 보존                                  | 지원                    | 12수 transform, 3수 offset. 현재 object instance 수준만 typed 생성                                                                                |
| `slice_info.config`                                                                                                 | 원본 보존                                      | client/version header만 | filament 사용량·예상 시간·무게·warnings·슬라이싱 성공 상태 생성 미지원                                                                            |
| G-code/툴패스/AMS 전송·실제 tray 매핑                                                                               | 원본 보존                                      | 생성·검증 미지원        | `BambuStudioProject.toDocument()`는 재슬라이싱하지 않음                                                                                           |
| no-light/top/pick/pattern thumbnail 및 bbox                                                                         | 원본 보존                                      | typed API 미지원        | `BambuStudioProject.inspect().plates`는 이 참조가 있으면 명시적 미지원 오류. generic `ThreeMFDocument.read()`는 첨부를 유지                       |
| `filament_sequence.json`, layer ranges/heights, custom G-code, brim ears, cut information, assembly tree/step/model | 원본 보존                                      | typed 생성·해석 미지원  | `Document.attachments`로 이미 준비된 원본 파일 삽입 가능                                                                                          |
| triangle paint_color/paint_supports/paint_seam/face_property                                                        | 미지원 XML 오류                                | 미지원                  | 지원하지 않는 model XML을 조용히 삭제하지 않음                                                                                                    |
| emboss/text/font 등 config 안의 vendor 구조                                                                         | XML 첨부 원본 보존                             | typed 재구성 미지원     | 기존 config를 일반 import/save 하는 경우만 보존                                                                                                   |

`BambuStudioProject.toDocument()`는 전달한 object/plate 설정으로 `model_settings.config`를 다시 만들고 `slice_info.config`를 header만으로 다시 만듭니다. 따라서 **기존 sliced 프로젝트를 완전하게 편집하는 API로 사용하면 안 됩니다**. 소유하는 세 config 파일은 대체하고 기타 첨부는 유지합니다. `setPresets()`를 호출하지 않으면 기존 개별 preset 파일을 유지하며, 호출하면 전체 현대 preset 컬렉션을 교체합니다(`[]`는 제거). 제거된 preset 파일을 source 또는 internal target으로 갖는 OPC 관계도 제거합니다. 같은 경로의 preset이 대체되는 경우 그 관계는 유지합니다.

## 프로필 사용 예제

```ts
import { ThreeMFDocument } from "@uselessworks/3mfiy";
import {
  BambuProfile,
  BambuStudioProject,
  BambuPreset,
  BambuPresetKind,
  BambuPlate,
} from "@uselessworks/3mfiy/bambu";

const profile = new BambuProfile(callerOwnedResolvedProfile).setFilaments([
  { settingsId: "PLA white", color: "#FFFFFF" },
  { settingsId: "PLA black", color: "#202020" },
]);
const project = new BambuStudioProject(document, {
  applicationVersion: studioVersion,
  profile,
});
project.setPresets([
  new BambuPreset(BambuPresetKind.Filament, {
    name: "PLA white",
    from: "project",
    version: studioVersion,
    filament_settings_id: ["PLA white"],
    inherits: "Caller-selected system preset",
    nozzle_temperature: ["220"],
  }),
]);
for (const settings of objectSettings) project.setObjectSettings(settings);
const plate = project.addPlate(
  new BambuPlate(1, {
    name: "First plate",
    locked: false,
    bedType: "Textured PEI Plate",
    printSequence: "by layer",
    filamentMapMode: "Manual",
    filamentMaps: [1, 1],
    thumbnail: renderedPng,
  }),
);
for (const instance of plateInstances) plate.addInstance(instance);
const inspection = BambuStudioProject.inspect(
  ThreeMFDocument.read(project.write()),
);
const profiles = inspection.profile?.toData();
const plates = inspection.plates;
```

`BambuProfile.setFilaments()`는 기존 설정의 slot 수를 임의 변경하지 않고 identity/color 벡터를 갱신합니다. `filament_multi_colour`의 다색 문자열은 보존하며, 기존 단색과 일치하는 항목만 새 색으로 동기화합니다. 온도·유량·variant 값을 선택한 preset에서 가져오거나 여러 프로필을 합치는 resolver가 아닙니다. 필라멘트 수 또는 material preset이 달라지면 그에 맞는 전체 base 설정을 호출자가 제공해야 합니다.

개별 preset 생성 시 비어 있지 않은 `inherits`를 요구합니다. 해당 부모 프로필이 실제 Studio에 설치되어 있는지는 호출자가 확인해야 합니다. 읽기 API는 상속 정보가 없는 기존 preset도 보존합니다. 전체 project 설정 JSON은 이미 해석된 값을 전달해야 하며, preset 파일의 존재만으로 그 값이 project 설정에 병합되지는 않습니다.

`BambuStudioProject`는 입력 문서·profile을 복사 소유하며, `project.profile` 및 `addPlate()` 반환 객체의 변경을 다음 저장에 반영합니다. `inspect()`는 부분 조회 전용 객체이며 write 메서드를 제공하지 않습니다. 일반 `ThreeMFDocument`로 원본 첨부를 보존하는 저장과 vendor 설정의 재생성을 구분합니다.

## 검증

- synthetic regression: 단일part slot 2 유지, 잘못된 slot 상한/충돌 거부, 여러 plate/빈 plate/반복 instance, plate settings·PNG 읽기/쓰기, preset 3종의 독립 번호·이름·교체/보존, wire 타입 검사.
- 실제 Formify X2D profile: 569개 key의 JSON 값을 왕복 보존. slot 8개, variant/self-index 32개, nozzle 2개, flush vector 128개를 그대로 유지한 채 export/import.
- 실제 Snowfiy sample: 3 plate, 48 instance 및 통합 profile을 typed 조회.
- Node와 browser/Worker가 같은 API를 사용합니다. 실제 Bambu Studio GUI의 로딩·슬라이싱 검증은 수행하지 않았습니다.
