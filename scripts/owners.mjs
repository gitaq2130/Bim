// 파일 소유 트랙 정의 — 각 트랙(대화창/세션)은 자기 파일만 수정한다.
// 여기 없는 파일은 core(허브) 소유.
export const TRACKS = {
  core: {
    name: '허브·코어',
    branch: 'builder/core',
    files: [
      'app/index.html', 'app/js/app.js', 'app/js/model.js', 'app/js/store.js', 'app/js/ui.js', 'app/js/util.js',
      'app/js/rev.js', 'app/js/rebar.js', 'app/js/excel.js', 'app/js/zip.js',
      'app/js/dxf.js', 'app/js/blocks.js', 'app/js/icons.js', 'app/js/ifc.js', 'app/js/ifcout.js',
      'app/js/house.js', 'app/js/tower.js', 'app/lib/', 'docs/CORE.md', 'CORE_VERSION', 'CLAUDE.md',
      'scripts/', '.github/', 'package.json',
    ],
  },
  cad: {
    name: '작도(CAD)', branch: 'builder/cad',
    files: ['app/tools/cad.js', 'app/tools/cad-geom.js', 'app/tools/pdf.js', 'app/js/wand.js', 'app/js/section.js', 'docs/tools/cad.md'],
  },
  view3d: {
    name: '3D 뷰어', branch: 'builder/view3d',
    files: ['app/tools/view3d.js', 'app/tools/render3d.js', 'app/js/sun.js', 'docs/tools/view3d.md'],
  },
  struct: {
    name: '구조해석·설계', branch: 'builder/struct',
    files: ['app/tools/struct.js', 'app/tools/structsim.js', 'app/js/kds.js', 'app/js/structauto.js', 'app/js/structmodel.js',
      'app/js/fem.js', 'app/js/plate.js', 'app/js/simcore.js', 'app/js/schemes.js', 'app/tools/structscheme.js', 'docs/tools/struct.md'],
  },
  cost: {
    name: '물량·기성', branch: 'builder/cost',
    files: ['app/tools/qto.js', 'app/tools/bill.js', 'docs/tools/cost.md'],
  },
  review: {
    name: '간섭·정합', branch: 'builder/review',
    files: ['app/tools/clash.js', 'app/tools/check.js', 'docs/tools/review.md'],
  },
  field: {
    name: '공정·현장·일보', branch: 'builder/field',
    files: ['app/tools/sched.js', 'app/tools/site.js', 'app/tools/daily.js', 'docs/tools/field.md'],
  },
  mep: {
    name: '설비·전기·소방(MEP)', branch: 'builder/mep',
    files: ['app/tools/mep.js', 'app/js/mep.js', 'docs/tools/mep.md'],
  },
  interior: {
    name: '인테리어·조명', branch: 'builder/interior',
    files: ['app/tools/interior.js', 'app/js/furn.js', 'app/tools/furn3d.js', 'docs/tools/interior.md'],
  },
  admin: {
    name: '이슈·법규', branch: 'builder/admin',
    files: ['app/tools/issue.js', 'app/tools/code.js', 'docs/tools/admin.md'],
  },
};

// 모든 트랙이 함께 쓰는 파일 (충돌 주의, 자기 항목만 추가)
export const SHARED = ['CHANGELOG.md', 'docs/sessions/'];

export function ownerOf(path) {
  if (SHARED.some(p => path === p || (p.endsWith('/') && path.startsWith(p)))) return 'shared';
  for (const [id, t] of Object.entries(TRACKS)) {
    if (id === 'core') continue;
    if (t.files.some(p => path === p || (p.endsWith('/') && path.startsWith(p)))) return id;
  }
  return 'core';
}
