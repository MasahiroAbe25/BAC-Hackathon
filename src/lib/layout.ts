import {
  forceSimulation,
  forceLink,
  forceCollide,
  forceRadial,
  forceManyBody,
  forceX,
  forceY,
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
  kind: TreeNode["type"] | "sub-leaf";
  branchAngle?: number; // for sector guidance
}

const BRANCH_RADIUS = 150;
const BASE_LEAF_RADIUS = 170;
const LEAF_RADIUS_PER_NODE = 28;
const MIN_LEAF_RADIUS = 240;
const SUB_LEAF_OFFSET = 110; // distance from leaf to sub-leaf
const FLOATING_RADIUS = 340;

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
 * Run a d3-force simulation for leaf/sub-leaf/floating nodes.
 * center & branches are fixed (fx/fy); previously placed nodes are fixed too.
 * Leaf radius scales with the number of leaves per branch to prevent crowding.
 * Sub-leaves are attracted to their parent leaf node.
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

  // Count direct leaves per branch to scale the target radius
  const leafCountPerBranch = new Map<string, number>();
  for (const node of nodes) {
    if (node.type === "leaf" && node.parentBranchId && !node.parentLeafId) {
      leafCountPerBranch.set(
        node.parentBranchId,
        (leafCountPerBranch.get(node.parentBranchId) ?? 0) + 1
      );
    }
  }
  const maxDirectLeaves = leafCountPerBranch.size > 0
    ? Math.max(...leafCountPerBranch.values())
    : 0;
  const DYNAMIC_LEAF_RADIUS = Math.max(
    MIN_LEAF_RADIUS,
    BASE_LEAF_RADIUS + maxDirectLeaves * LEAF_RADIUS_PER_NODE
  );
  const DYNAMIC_SUB_LEAF_RADIUS = DYNAMIC_LEAF_RADIUS + SUB_LEAF_OFFSET;

  const simNodes: SimNode[] = [];
  const links: SimulationLinkDatum<SimNode>[] = [];

  // Build a map of branchId → angle for sector guidance
  const branchAngleById = new Map<string, number>();
  for (const [branchId, index] of branchIndexById) {
    branchAngleById.set(branchId, branchAngle(index));
  }

  const centerNode: SimNode = { id: "center", kind: "center", fx: 0, fy: 0, x: 0, y: 0 };
  simNodes.push(centerNode);

  for (const [branchId, index] of branchIndexById) {
    const pos = branchPosition(branchId, index, rootSize, branchSize(branchId));
    simNodes.push({
      id: branchId,
      kind: "branch",
      fx: pos.x,
      fy: pos.y,
      x: pos.x,
      y: pos.y,
      branchAngle: branchAngle(index),
    });
  }

  // Map from any leaf/sub-leaf id → sim node for child seeding (supports chains)
  const leafSimNodeById = new Map<string, SimNode>();

  // First pass: add direct leaves (parentLeafId is absent/null)
  for (const node of nodes) {
    if (node.type !== "leaf" && node.type !== "floating") continue;
    if (node.parentLeafId) continue; // sub-leaves handled in second pass

    const fixed = fixedPositions.get(node.id);
    const angle = Math.random() * Math.PI * 2;
    const seedRadius = node.type === "leaf" ? DYNAMIC_LEAF_RADIUS : FLOATING_RADIUS;
    const parentAngle = node.parentBranchId
      ? (branchAngleById.get(node.parentBranchId) ?? angle)
      : angle;

    const sim: SimNode = {
      id: node.id,
      kind: node.type,
      x: fixed?.x ?? Math.cos(angle) * seedRadius,
      y: fixed?.y ?? Math.sin(angle) * seedRadius,
      branchAngle: parentAngle,
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
    if (node.type === "leaf") leafSimNodeById.set(node.id, sim);
    if (node.type === "leaf" && node.parentBranchId) {
      links.push({ source: node.id, target: node.parentBranchId });
    }
  }

  // Second pass: add sub-leaves (parentLeafId is set)
  for (const node of nodes) {
    if (node.type !== "leaf" || !node.parentLeafId) continue;

    const fixed = fixedPositions.get(node.id);
    const parentSim = leafSimNodeById.get(node.parentLeafId);
    const parentFixed = fixedPositions.get(node.parentLeafId);
    const px = parentFixed?.x ?? parentSim?.x ?? 0;
    const py = parentFixed?.y ?? parentSim?.y ?? 0;

    const sim: SimNode = {
      id: node.id,
      kind: "sub-leaf",
      x: fixed?.x ?? px * 1.35 + (Math.random() - 0.5) * 30,
      y: fixed?.y ?? py * 1.35 + (Math.random() - 0.5) * 30,
      branchAngle: parentSim?.branchAngle,
    };

    if (fixed) {
      sim.fx = fixed.x;
      sim.fy = fixed.y;
    }

    simNodes.push(sim);
    // Register in leafSimNodeById so deeper nesting can seed from this node
    leafSimNodeById.set(node.id, sim);
    links.push({ source: node.id, target: node.parentLeafId });
  }

  // Build per-node sector target coordinates for forceX/forceY.
  // Only direct leaves get sector guidance — sub-leaves follow their parent
  // via forceLink and should NOT be pulled to the leaf radius independently.
  const sectorTargetX = (d: SimNode): number => {
    if (d.branchAngle == null) return 0;
    return Math.cos(d.branchAngle) * DYNAMIC_LEAF_RADIUS;
  };
  const sectorTargetY = (d: SimNode): number => {
    if (d.branchAngle == null) return 0;
    return Math.sin(d.branchAngle) * DYNAMIC_LEAF_RADIUS;
  };
  const isFreeDirectLeaf = (d: SimNode) => d.kind === "leaf" && d.fx == null;

  const simulation = forceSimulation(simNodes)
    .force(
      "link",
      forceLink<SimNode, SimulationLinkDatum<SimNode>>(links)
        .id((d) => d.id)
        .distance((link) => {
          const target = link.target as SimNode;
          // leaf→branch: 60, sub-leaf→leaf: 140 (must exceed collision sum 72+58=130)
          return target.kind === "branch" ? 60 : 140;
        })
        .strength((link) => {
          const target = link.target as SimNode;
          // Strong link for sub-leaves so they stay near parent leaf
          return target.kind === "branch" ? 0.3 : 0.7;
        })
    )
    .force(
      "collide",
      forceCollide<SimNode>().radius((d) => {
        if (d.kind === "branch") return 85;
        if (d.kind === "leaf") return 72;
        return 58; // sub-leaf, floating
      })
    )
    .force(
      "radial",
      forceRadial<SimNode>(
        (d) => {
          if (d.kind === "floating") return FLOATING_RADIUS;
          if (d.kind === "sub-leaf") return DYNAMIC_SUB_LEAF_RADIUS;
          if (d.kind === "leaf") return DYNAMIC_LEAF_RADIUS;
          return 0;
        },
        0,
        0
      ).strength((d) => {
        if (d.kind === "leaf" || d.kind === "floating") return 0.6;
        // Sub-leaves: weak radial pull so forceLink (to parent leaf) dominates
        if (d.kind === "sub-leaf") return 0.2;
        return 0;
      })
    )
    .force("charge", forceManyBody<SimNode>().strength(-40))
    // Sector guidance: nudge leaves toward their branch direction
    .force(
      "sectorX",
      forceX<SimNode>(sectorTargetX).strength((d) => (isFreeDirectLeaf(d) ? 0.15 : 0))
    )
    .force(
      "sectorY",
      forceY<SimNode>(sectorTargetY).strength((d) => (isFreeDirectLeaf(d) ? 0.15 : 0))
    )
    .stop();

  for (let i = 0; i < 300; i += 1) {
    simulation.tick();
  }

  return simNodes
    .filter((n) => n.kind === "leaf" || n.kind === "sub-leaf" || n.kind === "floating")
    .map((n) => ({ id: n.id, x: n.x ?? 0, y: n.y ?? 0 }));
}
