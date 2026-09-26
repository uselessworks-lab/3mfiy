# 기존 프로젝트 적용

기존 다섯 프로젝트는 읽기 전용으로 조사했습니다. 이번 작업은 공통 패키지와 어댑터를 만들고 적용 지점을 정리하는 범위이며, 형제 저장소의 export 함수/lockfile은 수정하지 않았습니다. 아래 변경 시 프로젝트별 geometry와 profile을 그대로 유지하며 기존 회귀 테스트를 실행해야 합니다.

| 프로젝트 | 조사한 export 파일                               | 이관할 공통 부분                                              | 애플리케이션에 남길 부분                                                  |
| -------- | ------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Formify  | `packages/formify-core/src/export/threeMF.ts`    | mesh XML, materials, components, Production/OPC, Bambu config | printableComposition, top-face-down/brim, X2D profile, 슬롯 fallback      |
| Runify   | `packages/runify-core/src/export/encode3mf.ts`   | part별 mesh, objectGroups, metadata, OPC/config               | 전체 mesh의 part range 분리, A1 profile, progress UI, attribution         |
| Spookify | `packages/spookify-core/src/export/encode3mf.ts` | colored child mesh, wrapper, UUID/OPC/config                  | geometry validation, plate packing, material roles, makerlab OBJ          |
| Snowfiy  | `package/core/src/three-mf.ts`                   | mesh XML, multi-object, materials, OPC/config                 | snowflake generator, bounds/plate fit, logical plate offsets              |
| Flexify  | `package/core/src/export/three-mf.ts`            | colored parts, assembly, Production/OPC/config                | manifold geometry, part offsets, palette/extruder assignment, X2D profile |

## 배포 전 로컬 연결

```sh
# 이 저장소에서
npm run build
npm pack --workspace @uselessworks/3mfiy --pack-destination /tmp
# 각 소비 프로젝트에서 패키지 배포 전 검증 시 사용
npm install /tmp/uselessworks-3mfiy-0.1.0.tgz
```

## 일반 export 교체

```ts
import {
  ThreeMFDocument,
  MeshGeometry,
  Transform3D,
} from "@uselessworks/3mfiy";

const { document, objects } = ThreeMFDocument.create3mf(
  groups.map((group) => ({
    name: group.name,
    transform: group.transform ? new Transform3D(group.transform) : undefined,
    parts: group.parts.map((part) => ({
      name: part.name,
      color: part.color,
      mesh: MeshGeometry.fromBuffers(part.vertProperties, part.triVerts, {
        stride: part.numProp,
      }),
    })),
  })),
  {
    meshPath: "/3D/Objects/meshes.model", // 생략하면 Core 단일 모델
    metadata: [
      { name: "Application", value: applicationName },
      { name: "Title", value: title },
    ],
  },
);
const bytes = document.write();
```

이미 xyz/index 배열이면 `new MeshGeometry(positions, indices)`를 사용합니다. 버퍼는 객체가 복사 소유하므로 원본을 수정해도 문서가 바뀌지 않습니다. Runify의 global indices와 part startVertex/range는 로컬 mesh에 맞게 재매핑해야 합니다. 라이브러리는 애플리케이션의 part range 의미를 추측하지 않습니다.

기존 ArrayBuffer 반환 계약은 `bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)`로 감쌉니다. progress는 객체 준비/패키징 전후에 앱이 표시하며 압축 중 granular progress는 현재 지원하지 않습니다.

## Bambu export

```ts
import {
  BambuStudioProject,
  BambuProfile,
  BambuPlate,
} from "@uselessworks/3mfiy/bambu";

const project = new BambuStudioProject(document, {
  applicationVersion: profile.applicationVersion,
  profile: new BambuProfile(profile.json), // 기존 앱이 보유한 해석된 전체 설정
});
for (const [i, binding] of objects.entries()) {
  project.setObjectSettings({
    objectId: binding.objectId,
    name: groups[i].name,
    parts: binding.partIds.map((objectId, j) => ({
      objectId,
      name: groups[i].parts[j].name,
      extruder: groups[i].parts[j].extruder, // 1-based, app-owned mapping
    })),
  });
}
const plate = project.addPlate(new BambuPlate(1, { name: "Plate" }));
for (const [i, binding] of objects.entries()) {
  plate.addInstance({
    objectId: binding.objectId,
    instanceId: 0,
    identifyId: i + 1,
  });
}
const bytes = project.write();
```

Snowfiy의 다중 plate는 기존 transform과 여러 `BambuPlate` 객체로 옮깁니다. 배정 이동은 기존 plate의 `removeInstance()`와 새 plate의 `addInstance()`로 처리합니다. `replaceInstances()`로 전체 배정을 교체할 수도 있습니다. 저장 직전에 모든 build instance가 정확히 한 plate에 배정되었는지 검증합니다.

라이브러리에 256 mm, 128 mm 중심, plate gap, 특정 기기 이름이 없습니다. Bambu의 part ID만 사용하는 config에는 서로 다른 파일에서 동일 ID를 가진 part가 모호할 수 있으므로 이런 구성을 거부합니다. part 설정은 직접 mesh component에만 지원합니다.

metadata의 표준 외 이름은 URI/prefix를 등록해서 사용합니다. 예: `{namespaces:{app:'urn:example:my-app'}, metadata:[{name:'app:Generator',value:'MyApp'}]}`. Bambu 비표준 version marker는 프로젝트 객체가 생성합니다. 이전 파일에 비표준 unqualified `Generator` 같은 값이 있으면 명시적 변경 후 이관해야 합니다.

## 기존 함수 API에서 변경된 점

미배포 상태에서 API를 객체 중심으로 교체했으므로 함수 alias는 남기지 않았습니다.

| 이전 함수                             | 현재 객체 API                                                   |
| ------------------------------------- | --------------------------------------------------------------- |
| `create3mf(objects, options)`         | `ThreeMFDocument.create3mf(objects, options)`                   |
| `read3mf(bytes)`                      | `ThreeMFDocument.read(bytes)` — document 인스턴스 반환          |
| `write3mf(data)`                      | `document.write()`                                              |
| `validateDocument(data)`              | `document.validate()`                                           |
| `meshFromBuffers(...)`                | `MeshGeometry.fromBuffers(...)`                                 |
| `translation`/`multiplyTransforms`    | `Transform3D.translation()`/`transform.then()`                  |
| `withBambuProject`                    | `new BambuStudioProject(...)` 후 객체 메서드로 구성             |
| `createBambuProjectSettings`          | `new BambuProfile(base).setFilaments(...)`                      |
| `readBambuProfiles`/`readBambuPlates` | `BambuStudioProject.inspect(document)`의 profile/presets/plates |

plain 데이터는 `ThreeMFDocument.fromData()`로 복원합니다. `toData()`는 typed array를 보존하는 structured-clone/Worker snapshot이며 JSON-safe 인코딩을 제공하지 않습니다. 기존 `Document` 등의 데이터 타입 이름은 `DocumentData` 등으로 명시했습니다.

Bambu 프로필은 string/string[] wire 값을 사용합니다. slot, 다중 노즐, 다색 프로필 보존과 개별 preset·plate 지원/미지원 범위는 [Bambu 지원 감사](bambu-support.md)에 기록했습니다.
