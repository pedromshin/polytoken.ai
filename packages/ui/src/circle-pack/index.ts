/**
 * @polytoken/ui/circle-pack — the shared zoomable circle-packing primitive
 * (FEATURE-CATALOG TM-01). Layout math (`packCircles`) and the zoom/navigation
 * state machine are exported alongside the React `CirclePack` component so
 * consumers (email TM-02, drive TM-04, the canvas node TM-03) and their tests
 * can reach the pure pieces without rendering.
 */

export { CirclePack } from "./circle-pack";
export type {
  CirclePackProps,
  CirclePackLeafRenderArgs,
} from "./circle-pack";
export {
  packCircles,
  type CircleDatum,
  type PackedCircle,
  type PackOptions,
} from "./circle-pack-layout";
export {
  CIRCLE_PACK_ROOT_ID,
  circlePackNavReducer,
  createCircleNavIndex,
  initialCirclePackNavState,
  type CircleNavIndex,
  type CirclePackNavState,
  type CirclePackNavAction,
} from "./circle-pack-zoom";
