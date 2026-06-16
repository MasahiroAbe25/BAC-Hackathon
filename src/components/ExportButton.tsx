import { forwardRef, useCallback, useImperativeHandle, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { toPng } from "html-to-image";
import type { NodeSize } from "../lib/layout";

export interface ExportHandle {
  isExporting: () => boolean;
  exportImage: () => Promise<void>;
}

interface Props {
  nodeSizes: Map<string, NodeSize>;
  title: string;
  onExportingChange?: (exporting: boolean) => void;
  onError?: (message: string) => void;
}

/**
 * ノード中心(sx,sy)から(tx,ty)方向に向かう直線がノード矩形境界(半幅hw,半高hh)と
 * 交わる点を返す。エッジのハンドル位置の近似値として使用する。
 */
function nodeEdgePoint(
  sx: number, sy: number,
  tx: number, ty: number,
  hw: number, hh: number,
): { x: number; y: number } {
  const dx = tx - sx;
  const dy = ty - sy;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return { x: sx, y: sy };
  const ux = dx / dist;
  const uy = dy / dist;
  const t = Math.min(
    Math.abs(ux) > 1e-9 ? hw / Math.abs(ux) : Infinity,
    Math.abs(uy) > 1e-9 ? hh / Math.abs(uy) : Infinity,
  );
  return { x: sx + ux * t, y: sy + uy * t };
}

// Headless component — must render inside <ReactFlow> to access useReactFlow().
// UI lives in the side panel; call exportImage() via a forwarded ref.
export const ExportButton = forwardRef<ExportHandle, Props>(
  function ExportButton({ nodeSizes, title, onExportingChange, onError }, ref) {
    const { getNodes, getEdges, getViewport, fitBounds, setViewport } = useReactFlow();
    const [exporting, setExporting] = useState(false);

    const setExportingState = useCallback((val: boolean) => {
      setExporting(val);
      onExportingChange?.(val);
    }, [onExportingChange]);

    const exportImage = useCallback(async () => {
      if (exporting) return;
      setExportingState(true);
      const prevViewport = getViewport();

      try {
        const nodes = getNodes();

        // フロー座標での bounding box 計算（origin=[0.5,0.5] なので position=センター）
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const node of nodes) {
          const size = nodeSizes.get(node.id);
          if (!size) continue;
          minX = Math.min(minX, node.position.x - size.width / 2);
          minY = Math.min(minY, node.position.y - size.height / 2);
          maxX = Math.max(maxX, node.position.x + size.width / 2);
          maxY = Math.max(maxY, node.position.y + size.height / 2);
        }

        // ノードサイズがまだ計測されていない場合は中断
        if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return;

        const PADDING = 60;
        const bounds = {
          x: minX - PADDING,
          y: minY - PADDING,
          width: maxX - minX + PADDING * 2,
          height: maxY - minY + PADDING * 2,
        };

        // ビューポートをコンテンツに合わせる（アニメーションなし）
        await fitBounds(bounds, { duration: 0 });
        await document.fonts.ready;
        await new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r()))
        );

        // fitBounds 後のビューポートからスクリーン座標を計算
        const { x: vx, y: vy, zoom } = getViewport();
        const screenLeft = bounds.x * zoom + vx;
        const screenTop = bounds.y * zoom + vy;
        const screenWidth = bounds.width * zoom;
        const screenHeight = bounds.height * zoom;

        // floating-drift アニメーションを停止してブレを防ぐ
        const driftEls = document.querySelectorAll<HTMLElement>(".floating-drift");
        driftEls.forEach((el) => (el.style.animationPlayState = "paused"));

        const rendererEl = document.querySelector<HTMLElement>(".react-flow__renderer");
        if (!rendererEl) throw new Error("renderer element not found");

        // ノードをキャプチャ（エッジは Canvas API で別途描画）
        // iOS Safari では foreignObject 内の SVG で overflow:visible が効かないため
        // SVG エッジが完全にクリップされる (WebKit バグ)。
        // エッジは react-flow__edges を filter で除外し、Canvas 2D API で後から直接描画する。
        //
        // backgroundColor は省略しない。
        // 透明背景だと iOS Safari の foreignObject でサブピクセルアンチエイリアシングが
        // 変わりフォント描画幅が変化するため、テキストが折り返されてしまう。
        const PIXEL_RATIO = 2;
        const fullDataUrl = await toPng(rendererEl, {
          pixelRatio: PIXEL_RATIO,
          backgroundColor: "#fafafc",
          filter: (node) => {
            const el = node as Element;
            if (typeof el.classList === "undefined") return true;
            return (
              !el.classList.contains("react-flow__panel") &&
              !el.classList.contains("react-flow__controls") &&
              !el.classList.contains("react-flow__background") &&
              !el.classList.contains("react-flow__edges") // Canvas API で描画するため除外
            );
          },
        });

        driftEls.forEach((el) => (el.style.animationPlayState = ""));

        // フルキャプチャからコンテンツ領域だけをクロップ
        const img = new Image();
        img.src = fullDataUrl;
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("image load failed"));
        });

        const cropCanvas = document.createElement("canvas");
        cropCanvas.width = Math.round(screenWidth * PIXEL_RATIO);
        cropCanvas.height = Math.round(screenHeight * PIXEL_RATIO);
        const ctx = cropCanvas.getContext("2d")!;

        // フロー座標 → クロップキャンバス座標の変換
        const toCanvasX = (flowX: number) => (flowX * zoom + vx - screenLeft) * PIXEL_RATIO;
        const toCanvasY = (flowY: number) => (flowY * zoom + vy - screenTop) * PIXEL_RATIO;
        const nodeMap = new Map(nodes.map((n) => [n.id, n]));

        // 1. 背景色で塗りつぶす
        ctx.fillStyle = "#fafafc";
        ctx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);

        // 2. ノード画像を描画
        // toPng に backgroundColor を渡しているため、ノード間の空白も白で埋まる。
        // エッジはこの後に描画して上に重ねる。
        ctx.drawImage(
          img,
          screenLeft * PIXEL_RATIO,
          screenTop * PIXEL_RATIO,
          screenWidth * PIXEL_RATIO,
          screenHeight * PIXEL_RATIO,
          0,
          0,
          cropCanvas.width,
          cropCanvas.height,
        );

        // 3. エッジをCanvas APIでノード画像の上に描画
        // ノードの枠線付近でエッジが重なるが細い線のため視覚的影響は小さい。
        ctx.lineCap = "round";
        for (const edge of getEdges()) {
          const srcNode = nodeMap.get(edge.source);
          const tgtNode = nodeMap.get(edge.target);
          if (!srcNode || !tgtNode) continue;

          const srcSize = nodeSizes.get(edge.source);
          const tgtSize = nodeSizes.get(edge.target);
          if (!srcSize || !tgtSize) continue;

          const sx = srcNode.position.x;
          const sy = srcNode.position.y;
          const tx = tgtNode.position.x;
          const ty = tgtNode.position.y;

          const p1 = nodeEdgePoint(sx, sy, tx, ty, srcSize.width / 2, srcSize.height / 2);
          const p2 = nodeEdgePoint(tx, ty, sx, sy, tgtSize.width / 2, tgtSize.height / 2);

          ctx.beginPath();
          ctx.strokeStyle = (edge.style?.stroke as string) ?? "#c9c4f7";
          ctx.lineWidth = ((edge.style?.strokeWidth as number) ?? 2) * zoom * PIXEL_RATIO;
          ctx.moveTo(toCanvasX(p1.x), toCanvasY(p1.y));
          ctx.lineTo(toCanvasX(p2.x), toCanvasY(p2.y));
          ctx.stroke();
        }

        const filename = `${title}-poster.png`;

        // Canvas → Blob に変換（Data URL より省メモリ・ファイル名が正しく扱われる）
        const blob = await new Promise<Blob>((res, rej) =>
          cropCanvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png")
        );

        // iOS 15+ / Android Chrome: Web Share API でシェアシートを表示
        // → 「写真に保存」を選ぶと写真アプリへ直接保存できる
        const shareFile = new File([blob], filename, { type: "image/png" });
        if (
          typeof navigator.canShare === "function" &&
          navigator.canShare({ files: [shareFile] })
        ) {
          try {
            await navigator.share({ files: [shareFile], title });
            return; // シェアシートで処理完了
          } catch (err) {
            if ((err as DOMException).name === "AbortError") return; // キャンセルはエラーでない
            // その他のエラーはフォールバックへ
          }
        }

        // デスクトップ / Web Share 非対応環境: Blob URL でダウンロード
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      } catch (err) {
        console.error("Export failed:", err);
        onError?.("📷 画像の書き出しに失敗しました。もう一度お試しください。");
      } finally {
        setViewport(prevViewport, { duration: 300 });
        setExportingState(false);
      }
    }, [exporting, setExportingState, getNodes, getEdges, getViewport, fitBounds, setViewport, nodeSizes, title]);

    useImperativeHandle(ref, () => ({
      isExporting: () => exporting,
      exportImage,
    }), [exporting, exportImage]);

    return null;
  }
);
