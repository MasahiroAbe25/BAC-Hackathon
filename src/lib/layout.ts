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
const BRANCH_ANGLES: Record<string, number> = {
  weapon: -90,
  growth: 30,
  workstyle: 150,
};

export function branchPosition(branchId: string, index: number): { x: number; y: number } {
  const deg = BRANCH_ANGLES[branchId] ?? -90 + index * 120;
  const rad = (deg * Math.PI) / 180;
  return {
    x: Math.cos(rad) * BRANCH_RADIUS,
    y: Math.sin(rad) * BRANCH_RADIUS,
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
  branchIndexById: Map<string, number>
): Positioned[] {
  const simNodes: SimNode[] = [];
  const links: SimulationLinkDatum<SimNode>[] = [];

  const centerNode: SimNode = { id: "center", kind: "center", fx: 0, fy: 0, x: 0, y: 0 };
  simNodes.push(centerNode);

  for (const [branchId, index] of branchIndexById) {
    const pos = branchPosition(branchId, index);
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
      const parentPos = branchPosition(node.parentBranchId, branchIndexById.get(node.parentBranchId) ?? 0);
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
