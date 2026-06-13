import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Diagnosis, TopicInput, Source } from "../types";
import { branchPosition, type NodeSize } from "../lib/layout";
import { useMemoryTree, type AddResult, type LayoutSizes } from "../hooks/useMemoryTree";
import { CenterNode, BranchNode, LeafNode, FloatingNode } from "./nodes";
import { StraightConnector } from "./edges";
import MiningPanel from "./MiningPanel";
import KenChatPanel from "./KenChatPanel";
import { ExportButton, type ExportHandle } from "./ExportButton";

const nodeTypes = {
  center: CenterNode,
  branch: BranchNode,
  leaf: LeafNode,
  floating: FloatingNode,
};

const edgeTypes = {
  connector: StraightConnector,
};

interface Props {
  diagnosis: Diagnosis;
}

export default function TreeScreen({ diagnosis }: Props) {
  const sizesRef = useRef<LayoutSizes>({});
  const getSizes = useCallback((): LayoutSizes => sizesRef.current, []);
  const { treeNodes, positions, addTopics, resetTree } = useMemoryTree(diagnosis, getSizes);
  const [tab, setTab] = useState<"mining" | "ken">("mining");
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const exportRef = useRef<ExportHandle>(null);

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

  const canvasRef = useRef<HTMLDivElement>(null);
  const [nodeSizes, setNodeSizes] = useState<Map<string, NodeSize>>(new Map());

  // Measure the rendered react-flow node boxes so connector radii can be
  // computed from real sizes (keeps the visible edge-to-edge gap constant).
  const measureNodes = useCallback(() => {
    const root = canvasRef.current;
    if (!root) return;
    const els = root.querySelectorAll<HTMLElement>(".react-flow__node[data-id]");
    const next = new Map<string, NodeSize>();
    els.forEach((el) => {
      const id = el.getAttribute("data-id");
      if (!id) return;
      // offsetWidth/Height are layout pixels, unaffected by the viewport's
      // CSS zoom transform, so they match react-flow coordinate units.
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      if (width > 0 && height > 0) {
        next.set(id, { width, height });
      }
    });
    setNodeSizes((prev) => {
      if (prev.size === next.size) {
        let same = true;
        for (const [id, size] of next) {
          const old = prev.get(id);
          if (!old || Math.abs(old.width - size.width) > 0.5 || Math.abs(old.height - size.height) > 0.5) {
            same = false;
            break;
          }
        }
        if (same) return prev;
      }
      return next;
    });
  }, []);

  // Re-measure whenever the set of nodes changes (initial render + new leaves)
  // and on window resize. A short rAF chain lets fonts/layout settle first.
  useLayoutEffect(() => {
    let frame1 = 0;
    let frame2 = 0;
    frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(measureNodes);
    });
    window.addEventListener("resize", measureNodes);
    return () => {
      cancelAnimationFrame(frame1);
      cancelAnimationFrame(frame2);
      window.removeEventListener("resize", measureNodes);
    };
  }, [measureNodes, treeNodes, diagnosis]);

  const handleReset = () => {
    if (!window.confirm("マインドマップをリセットしますか？この操作は元に戻せません。")) return;
    resetTree();
    setFreshIds(new Set());
    setToast(null);
  };

  const handleTopics = (topics: TopicInput[], source: Source) => {
    // サイズ計測が完了する前に送信された場合はスキップ。
    // 計測前にノードを配置すると fixedRef に誤った座標が永続的に固定されるため。
    if (nodeSizes.size === 0) return;
    const results = addTopics(topics, source);
    if (results.length === 0) return;
    setFreshIds(new Set(results.map((result) => result.node.id)));
    setToast(buildToast(results));
  };

  const rootSize = nodeSizes.get("center");

  // useEffect ではなくレンダー中に同期更新することで、addTopics 呼び出し時に
  // sizesRef が常に最新の nodeSizes を反映するようにする(1レンダー遅れを解消)。
  const branchSizesForRef = new Map<string, NodeSize>();
  for (const branch of diagnosis.branches) {
    const size = nodeSizes.get(branch.id);
    if (size) branchSizesForRef.set(branch.id, size);
  }
  sizesRef.current = { root: rootSize, branches: branchSizesForRef };

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
        const pos = branchPosition(branch.id, index, rootSize, nodeSizes.get(branch.id));
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
  }, [diagnosis, treeNodes, positions, freshIds, nodeSizes, rootSize]);

  const flowEdges: Edge[] = useMemo(() => {
    const edges: Edge[] = diagnosis.branches.map((branch) => ({
      id: `center-${branch.id}`,
      type: "connector",
      source: "center",
      target: branch.id,
      style: { stroke: "#5b4fe0", strokeWidth: 2.5 },
    }));
    for (const node of treeNodes) {
      if (node.type === "leaf" && node.parentBranchId) {
        edges.push({
          id: `${node.parentBranchId}-${node.id}`,
          type: "connector",
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
      <div className="tree-canvas" ref={canvasRef}>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          proOptions={{ hideAttribution: true }}
          nodesConnectable={false}
          elementsSelectable={false}
        >
          <Background color="#e3e1f2" gap={24} />
          <Controls showInteractive={false} />
          <ExportButton
            ref={exportRef}
            nodeSizes={nodeSizes}
            title={diagnosis.title}
            onExportingChange={setIsExporting}
          />
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
              treeNodes={treeNodes}
              onTopics={(topics) => handleTopics(topics, "ken_dialogue")}
            />
          )}
        </div>
        <div className="side-actions">
          <button className="ghost-button" onClick={handleReset}>
            やり直す
          </button>
          <button
            className="primary-button side-export-button"
            onClick={() => exportRef.current?.exportImage()}
            disabled={isExporting}
          >
            {isExporting ? "書き出し中…" : "📷 画像を保存"}
          </button>
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
