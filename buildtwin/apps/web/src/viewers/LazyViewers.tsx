/**
 * 뷰어 컴포넌트 지연 로딩 래퍼. 페이지는 이 래퍼와 sync/viewerTypes 의 핸들 타입만 안다.
 */
import React, { Suspense, forwardRef } from "react";
import type { Viewer2DHandle, Viewer2DProps, Viewer3DHandle, Viewer3DProps } from "../sync/viewerTypes";

const Viewer3DInner = React.lazy(() => import("../viewer3d").then((m) => ({ default: m.Viewer3D })));
const Viewer2DInner = React.lazy(() => import("../viewer2d").then((m) => ({ default: m.Viewer2D })));

const Loading = ({ label }: { label: string }) => <div className="viewer-loading">{label} 로딩 중…</div>;

export const LazyViewer3D = forwardRef<Viewer3DHandle, Viewer3DProps>(function LazyViewer3D(props, ref) {
  return (
    <Suspense fallback={<Loading label="3D 뷰어" />}>
      <Viewer3DInner ref={ref} {...props} />
    </Suspense>
  );
});

export const LazyViewer2D = forwardRef<Viewer2DHandle, Viewer2DProps>(function LazyViewer2D(props, ref) {
  return (
    <Suspense fallback={<Loading label="2D 뷰어" />}>
      <Viewer2DInner ref={ref} {...props} />
    </Suspense>
  );
});
