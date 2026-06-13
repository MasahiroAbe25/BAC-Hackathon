import {
  forceSimulation,
  forceLink,
  forceCollide,
  forceRadial,
  forceManyBody,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import type { TreeNode } from "../types";

export interface Positioned {
  id: string;
  x: number;
  y: number;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  kind: TreeNode["type"];
}

const BRANCH_RADIUS = 150;
const LEAF_RADIUS = 220;
const FLOATING_RADIUS = 320;

/**
 * Radial layout parameters for the root's direct children (branches).
 * - `startAngleDeg`: angle of the first branch (screen coords, +y points down,
 *   so -90deg points straight up).
 * - `stepAngleDeg`: angle increment between consecutive branches. With 3
 *   branches this is 120deg (equilateral). To support 4+ directions in the
 *   future, lower this value (e.g. 90deg for 4 branches) — no other code needs
 *   to change.
 */
export const BRANCH_LAYOUT = {
  radius: BRANCH_RADIUS,
  startAngleDeg: -90,
  stepAngleDeg: 120,
  /**
   * Visible gap (in px) between the root box and each child box, measured
   * along the connector. Kept constant for every direction so all three
   * connector lines read the same visible length.
   */
  gapPx: 48,
};

/** Fallback node sizes used before real DOM measurements are available. */
const FALLBACK_NODE_SIZE: NodeSize = { width: 140, height: 56 };

export interface NodeSize {
  width: number;
  height: number;
}

/** Angle (in radians, screen coords) for the branch at the given index. */
export function branchAngle(index: number): number {
  const deg = BRANCH_LAYOUT.startAngleDeg + index * BRANCH_LAYOUT.stepAngleDeg;
  return (deg * Math.PI) / 180;
}

/**
 * Distance from a node's centre to where the ray at `angle` exits the node's
 * axis-aligned bounding box (half-width / half-height rectangle). This is the
 * "radius of the box in that direction", so subtracting nothing and adding a
 * constant gap yields a uniform visible line length regardless of node size.
 */
export function boxRadiusAtAngle(size: NodeSize, angle: number): number {
  const halfW = size.width / 2;
  const halfH = size.height / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const tCandidates: number[] = [];
  if (Math.abs(cos) > 1e-6) tCandidates.push(halfW / Math.abs(cos));
  if (Math.abs(sin) > 1e-6) tCandidates.push(halfH / Math.abs(sin));
  if (tCandidates.length === 0) return Math.max(halfW, halfH);
  return Math.min(...tCandidates);
}

/**
 * Position of a branch node, computed uniformly for every direction.
 *
 * radius = rootBoxRadius(angle) + GAP_PX + childBoxRadius(angle)
 *
 * so the centre-to-centre distance grows/shrinks with the node sizes while the
 * visible edge-to-edge gap stays constant in all directions. When sizes are
 * omitted it falls back to the plain `BRANCH_LAYOUT.radius`.
 */
export function branchPosition(
  _branchId: string,
  index: number,
  rootSize?: NodeSize,
  childSize?: NodeSize
): { x: number; y: number } {
  const rad = branchAngle(index);
  let radius = BRANCH_LAYOUT.radius;
  if (rootSize || childSize) {
    const root = rootSize ?? FALLBACK_NODE_SIZE;
    const child = childSize ?? FALLBACK_NODE_SIZE;
    radius =
      boxRadiusAtAngle(root, rad) + BRANCH_LAYOUT.gapPx + boxRadiusAtAngle(child, rad);
  }
  return {
    x: Math.cos(rad) * radius,
    y: Math.sin(rad) * radius,
  };
}

/**
 * Run a d3-force simulation for leaf/floating nodes.
 * center & branches are fixed (fx/fy); previously placed nodes are fixed too.
 * Returns final positions for all non-fixed nodes.
 */
export function computeLayout(
  nodes: TreeNode[],
  fixedPositions: Map<string, { x: number; y: number }>,
  branchIndexById: Map<string, number>,
  sizes?: { root?: NodeSize; branches?: Map<string, NodeSize> }
): Positioned[] {
  const rootSize = sizes?.root;
  const branchSize = (branchId: string) => sizes?.branches?.get(branchId);
  const simNodes: SimNode[] = [];
  const links: SimulationLinkDatum<SimNode>[] = [];

  const centerNode: SimNode = { id: "center", kind: "center", fx: 0, fy: 0, x: 0, y: 0 };
  simNodes.push(centerNode);

  for (const [branchId, index] of branchIndexById) {
    const pos = branchPosition(branchId, index, rootSize, branchSize(branchId));
    simNodes.push({ id: branchId, kind: "branch", fx: pos.x, fy: pos.y, x: pos.x, y: pos.y });
  }

  for (const node of nodes) {
    if (node.type !== "leaf" && node.type !== "floating") continue;
    const fixed = fixedPositions.get(node.id);
    const angle = Math.random() * Math.PI * 2;
    const seedRadius = node.type === "leaf" ? LEAF_RADIUS : FLOATING_RADIUS;
    const sim: SimNode = {
      id: node.id,
      kind: node.type,
      x: fixed?.x ?? Math.cos(angle) * seedRadius,
      y: fixed?.y ?? Math.sin(angle) * seedRadius,
    };
    if (fixed) {
      sim.fx = fixed.x;
      sim.fy = fixed.y;
    } else if (node.type === "leaf" && node.parentBranchId) {
      const parentPos = branchPosition(
        node.parentBranchId,
        branchIndexById.get(node.parentBranchId) ?? 0,
        rootSize,
        branchSize(node.parentBranchId)
      );
      sim.x = parentPos.x * 1.4 + (Math.random() - 0.5) * 40;
      sim.y = parentPos.y * 1.4 + (Math.random() - 0.5) * 40;
    }
    simNodes.push(sim);
    if (node.type === "leaf" && node.parentBranchId) {
      links.push({ source: node.id, target: node.parentBranchId });
    }
  }

  const simulation = forceSimulation(simNodes)
    .force(
      "link",
      forceLink<SimNode, SimulationLinkDatum<SimNode>>(links)
        .id((d) => d.id)
        .distance(60)
        .strength(0.3)
    )
    .force("collide", forceCollide<SimNode>().radius(40))
    .force(
      "radial",
      forceRadial<SimNode>(
        (d) => (d.kind === "floating" ? FLOATING_RADIUS : d.kind === "leaf" ? LEAF_RADIUS : 0),
        0,
        0
      ).strength((d) => (d.kind === "leaf" || d.kind === "floating" ? 0.8 : 0))
    )
    .force("charge", forceManyBody<SimNode>().strength(-30))
    .stop();

  for (let i = 0; i < 120; i += 1) {
    simulation.tick();
  }

  return simNodes
    .filter((n) => n.kind === "leaf" || n.kind === "floating")
    .map((n) => ({ id: n.id, x: n.x ?? 0, y: n.y ?? 0 }));
}
