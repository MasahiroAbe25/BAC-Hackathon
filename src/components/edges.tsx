import { BaseEdge, getStraightPath, type EdgeProps } from "@xyflow/react";

/**
 * A single, shared connector renderer used for every edge in the tree
 * (root -> branch in all directions, and branch -> leaf). It draws a plain
 * straight line between the two node anchor points. No direction is treated
 * specially, so the upward, lower-right and lower-left branches all use the
 * exact same drawing logic. Replaces react-flow's default bezier edge, whose
 * Top/Bottom handle routing produced the wavy/S-shaped paths on the lower
 * branches.
 */
export function StraightConnector({
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  style,
}: EdgeProps) {
  const [edgePath] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  return <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />;
}
