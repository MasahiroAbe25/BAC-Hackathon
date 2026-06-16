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
  const { treeNodes, positions, addTopics, resetTree, reorganizeLayout } = useMemoryTree(diagnosis, getSizes);
  const [tab, setTab] = useState<"mining" | "ken">("mining");
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const isMobile = useIsMobile();
  const isKeyboardVisible = useKeyboardVisible(isMobile);
  const [mobileView, setMobileView] = useState<"map" | "panel">("map");
  const [toast, setToast] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const exportRef = useRef<ExportHandle>(null);

  const MIN_PANEL_WIDTH = 360;
  const [panelWidth, setPanelWidth] = useState(MIN_PANEL_WIDTH);
  const screenRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !screenRef.current) return;
      const rect = screenRef.current.getBoundingClientRect();
      const maxWidth = rect.width / 2;
      const newWidth = rect.right - e.clientX;
      setPanelWidth(Math.max(MIN_PANEL_WIDTH, Math.min(maxWidth, newWidth)));
    };
    const onMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

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
      if (node.type === "leaf" && node.parentLeafId) {
        // 孫葉: 親葉からのエッジ（細め）
        edges.push({
          id: `${node.parentLeafId}-${node.id}`,
          type: "connector",
          source: node.parentLeafId,
          target: node.id,
          style: { stroke: "#dbd8f8", strokeWidth: 1.5 },
        });
      } else if (node.type === "leaf" && node.parentBranchId) {
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

  // iOS がフォーカス時にページをスクロールするのを防ぐ
  useEffect(() => {
    if (!isMobile) return;
    const htmlPrev = document.documentElement.style.overflow;
    const bodyPrev = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden"; // html だけでは iOS がスクロールするケースがある

    // overflow:hidden をすり抜けたスクロールをその場でリセット
    const resetScroll = () => {
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };
    window.addEventListener("scroll", resetScroll, { passive: true });

    return () => {
      document.documentElement.style.overflow = htmlPrev;
      document.body.style.overflow = bodyPrev;
      window.removeEventListener("scroll", resetScroll);
    };
  }, [isMobile]);

  // PWA (standalone) モード対応: キーボード出現時に visual viewport の高さを CSS 変数へ反映。
  // Safari ブラウザはキーボードでレイアウト viewport を自動縮小するが、
  // PWA では layout viewport はそのままのため --vvh で補正する。
  useEffect(() => {
    if (!isMobile) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      document.documentElement.style.setProperty("--vvh", `${vv.height}px`);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      document.documentElement.style.removeProperty("--vvh");
    };
  }, [isMobile]);

  if (isMobile) {
    return (
      <div className={`tree-screen tree-screen--mobile${isKeyboardVisible ? " tree-screen--keyboard" : ""}`}>
        {toast && <div className="toast toast--mobile">{toast}</div>}
        <div
          className="tree-canvas"
          ref={canvasRef}
          style={mobileView !== "map" ? { visibility: "hidden", pointerEvents: "none" } : undefined}
        >
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
              onError={setToast}
            />
          </ReactFlow>
        </div>
        <aside
          className="side-panel side-panel--mobile"
          style={mobileView !== "panel" ? { visibility: "hidden", pointerEvents: "none" } : undefined}
        >
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
              💬 Kenと話す
            </button>
          </div>
          <div className="side-body">
            {tab === "mining" ? (
              <MiningPanel onTopics={(t) => handleTopics(t, "mining")} />
            ) : (
              <KenChatPanel
                diagnosis={diagnosis}
                treeNodes={treeNodes}
                onTopics={(t) => handleTopics(t, "ken_dialogue")}
              />
            )}
          </div>
          <div className="side-actions">
            <button className="ghost-button" onClick={reorganizeLayout} disabled={treeNodes.length === 0}>
              🗺️ 整える
            </button>
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
        <nav className="mobile-bottom-nav">
          <button
            className={`mobile-nav-btn${mobileView === "map" ? " active" : ""}`}
            onClick={() => setMobileView("map")}
          >
            <span className="mobile-nav-icon">🗺️</span>
            <span className="mobile-nav-label">マップ</span>
          </button>
          <button
            className={`mobile-nav-btn${mobileView === "panel" ? " active" : ""}`}
            onClick={() => setMobileView("panel")}
          >
            <span className="mobile-nav-icon">💬</span>
            <span className="mobile-nav-label">チャット</span>
          </button>
        </nav>
      </div>
    );
  }

  return (
    <div className="tree-screen" ref={screenRef}>
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
      <div
        className="panel-divider"
        onMouseDown={(e) => {
          e.preventDefault();
          isDragging.current = true;
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
        }}
      />
      <aside className="side-panel" style={{ width: panelWidth }}>
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
            💬 Kenと話す
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
          <button className="ghost-button" onClick={reorganizeLayout} disabled={treeNodes.length === 0}>
            🗺️ 整える
          </button>
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

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isMobile;
}

// focusin ではなく visualViewport のリサイズでキーボード表示を検知する。
// focusin は自動フォーカス(プログラム的な focus())でも発火するが、
// visualViewport は実際にキーボードが出た時だけ高さが変化するため誤検知しない。
function useKeyboardVisible(enabled: boolean): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const vv = window.visualViewport;
    if (!vv) return;
    let maxHeight = vv.height;
    const handler = () => {
      if (vv.height > maxHeight) maxHeight = vv.height;
      // キーボード高さが 150px 超 = キーボード表示中と判定
      setVisible(maxHeight - vv.height > 150);
    };
    vv.addEventListener("resize", handler);
    return () => vv.removeEventListener("resize", handler);
  }, [enabled]);
  return visible;
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
