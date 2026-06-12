import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Diagnosis, TopicInput, Source } from "../types";
import { branchPosition } from "../lib/layout";
import { useMemoryTree, type AddResult } from "../hooks/useMemoryTree";
import { CenterNode, BranchNode, LeafNode, FloatingNode } from "./nodes";
import MiningPanel from "./MiningPanel";
import KenChatPanel from "./KenChatPanel";

const nodeTypes = {
  center: CenterNode,
  branch: BranchNode,
  leaf: LeafNode,
  floating: FloatingNode,
};

interface Props {
  diagnosis: Diagnosis;
}

export default function TreeScreen({ diagnosis }: Props) {
  const { treeNodes, positions, addTopics } = useMemoryTree(diagnosis);
  const [tab, setTab] = useState<"mining" | "ken">("mining");
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (freshIds.size === 0) return;
    const timer = setTimeout(() => setFreshIds(new Set()), 4000);
    return () => clearTimeout(timer);
  }, [freshIds]);

  const handleTopics = (topics: TopicInput[], source: Source) => {
    const results = addTopics(topics, source);
    if (results.length === 0) return;
    setFreshIds(new Set(results.map((result) => result.node.id)));
    setToast(buildToast(results));
  };

  const flowNodes: Node[] = useMemo(() => {
    const list: Node[] = [
      {
        id: "center",
        type: "center",
        position: { x: 0, y: 0 },
        data: { label: diagnosis.title },
        draggable: false,
        origin: [0.5, 0.5] as [number, number],
      },
      ...diagnosis.branches.map((branch, index) => {
        const pos = branchPosition(branch.id, index);
        return {
          id: branch.id,
          type: "branch",
          position: pos,
          data: { label: branch.label, category: branch.category, branchId: branch.id },
          draggable: false,
          origin: [0.5, 0.5] as [number, number],
        };
      }),
      ...treeNodes.map((node) => {
        const pos = positions.get(node.id) ?? { x: 0, y: 0 };
        return {
          id: node.id,
          type: node.type,
          position: pos,
          data: {
            label: node.label,
            similarity: node.similarity?.toFixed(2),
            fresh: freshIds.has(node.id),
          },
          draggable: false,
          origin: [0.5, 0.5] as [number, number],
        };
      }),
    ];
    return list;
  }, [diagnosis, treeNodes, positions, freshIds]);

  const flowEdges: Edge[] = useMemo(() => {
    const edges: Edge[] = diagnosis.branches.map((branch) => ({
      id: `center-${branch.id}`,
      source: "center",
      target: branch.id,
      style: { stroke: "#5b4fe0", strokeWidth: 2.5 },
    }));
    for (const node of treeNodes) {
      if (node.type === "leaf" && node.parentBranchId) {
        edges.push({
          id: `${node.parentBranchId}-${node.id}`,
          source: node.parentBranchId,
          target: node.id,
          style: { stroke: "#c9c4f7", strokeWidth: 2 },
        });
      }
    }
    return edges;
  }, [diagnosis, treeNodes]);

  return (
    <div className="tree-screen">
      <div className="tree-canvas">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          proOptions={{ hideAttribution: true }}
          nodesConnectable={false}
          elementsSelectable={false}
        >
          <Background color="#e3e1f2" gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>
        {toast && <div className="toast">{toast}</div>}
      </div>
      <aside className="side-panel">
        <div className="side-tabs">
          <button
            className={`side-tab${tab === "mining" ? " active" : ""}`}
            onClick={() => setTab("mining")}
          >
            ✍️ 自分で書く
          </button>
          <button
            className={`side-tab${tab === "ken" ? " active" : ""}`}
            onClick={() => setTab("ken")}
          >
            💬 ケンと話す
          </button>
        </div>
        <div className="side-body">
          {tab === "mining" ? (
            <MiningPanel onTopics={(topics) => handleTopics(topics, "mining")} />
          ) : (
            <KenChatPanel
              diagnosis={diagnosis}
              onTopics={(topics) => handleTopics(topics, "ken_dialogue")}
            />
          )}
        </div>
      </aside>
    </div>
  );
}

function buildToast(results: AddResult[]): string {
  const attached = results.filter((result) => result.branchLabel);
  const floating = results.length - attached.length;
  const parts: string[] = [];
  if (attached.length > 0) {
    const labels = [...new Set(attached.map((result) => result.branchLabel))].join("・");
    parts.push(`🌱「${labels}」に枝が生えたよ!`);
  }
  if (floating > 0) {
    parts.push(`🫧 ${floating}個はまだふわふわ浮遊中…`);
  }
  return parts.join(" ");
}
