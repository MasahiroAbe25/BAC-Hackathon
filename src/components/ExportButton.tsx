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

// Headless component — must render inside <ReactFlow> to access useReactFlow().
// UI lives in the side panel; call exportImage() via a forwarded ref.
export const ExportButton = forwardRef<ExportHandle, Props>(
  function ExportButton({ nodeSizes, title, onExportingChange, onError }, ref) {
    const { getNodes, getViewport, fitBounds, setViewport } = useReactFlow();
    const [exporting, setExporting] = useState(false);

    const setExportingState = useCallback((val: boolean) => {
      setExporting(val);
      onExportingChange?.(val);
    }, [onExportingChange]);

    const exportImage = useCallback(async () => {
      if (exporting) return;
      setExportingState(true);
      const prevViewport = getViewport();
      // Edge SVGs that we temporarily resize for the capture (restored in finally)
      let edgeSvgs: SVGElement[] = [];
      let edgeSvgSnap: Array<{ left: string; top: string; width: string; height: string; viewBox: string | null }> = [];

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

        // iOS Safari: foreignObject 内の SVG では overflow:visible が無効なため、
        // ビューポート外のパスが描画されない (WebKit バグ)。
        // toPng 前に各エッジ SVG に viewBox + 明示サイズをセットしてパス座標をビューポート内に収める。
        // left/top を bounds.x/y にずらし viewBox を同じ座標に設定することで
        // スケール 1:1・座標ズレなしでビューポート境界を包む。
        edgeSvgs = Array.from(rendererEl.querySelectorAll<SVGElement>(".react-flow__edges svg"));
        edgeSvgSnap = edgeSvgs.map((svg) => ({
          left: svg.style.left,
          top: svg.style.top,
          width: svg.style.width,
          height: svg.style.height,
          viewBox: svg.getAttribute("viewBox"),
        }));
        edgeSvgs.forEach((svg) => {
          svg.style.left = `${bounds.x}px`;
          svg.style.top = `${bounds.y}px`;
          svg.style.width = `${bounds.width}px`;
          svg.style.height = `${bounds.height}px`;
          svg.setAttribute("viewBox", `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);
        });

        const PIXEL_RATIO = 2;
        const fullDataUrl = await toPng(rendererEl, {
          pixelRatio: PIXEL_RATIO,
          backgroundColor: "#fafafc",
          // パネル・コントロール・背景ドットを除外
          // Background の SVG は fitBounds 直後に NaN 属性を持つことがあり、
          // 不正な SVG になって img.onerror が発火するため除外する
          filter: (node) => {
            const el = node as Element;
            if (typeof el.classList === "undefined") return true;
            return (
              !el.classList.contains("react-flow__panel") &&
              !el.classList.contains("react-flow__controls") &&
              !el.classList.contains("react-flow__background")
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
        ctx.drawImage(
          img,
          screenLeft * PIXEL_RATIO,
          screenTop * PIXEL_RATIO,
          screenWidth * PIXEL_RATIO,
          screenHeight * PIXEL_RATIO,
          0,
          0,
          cropCanvas.width,
          cropCanvas.height
        );

        const a = document.createElement("a");
        a.href = cropCanvas.toDataURL("image/png");
        a.download = `${title}-poster.png`;
        a.click();
      } catch (err) {
        console.error("Export failed:", err);
        onError?.("📷 画像の書き出しに失敗しました。もう一度お試しください。");
      } finally {
        // エッジ SVG のサイズ・位置・viewBox を元に戻す
        edgeSvgs.forEach((svg, i) => {
          svg.style.left = edgeSvgSnap[i].left;
          svg.style.top = edgeSvgSnap[i].top;
          svg.style.width = edgeSvgSnap[i].width;
          svg.style.height = edgeSvgSnap[i].height;
          const vb = edgeSvgSnap[i].viewBox;
          if (vb !== null) svg.setAttribute("viewBox", vb);
          else svg.removeAttribute("viewBox");
        });
        setViewport(prevViewport, { duration: 300 });
        setExportingState(false);
      }
    }, [exporting, setExportingState, getNodes, getViewport, fitBounds, setViewport, nodeSizes, title]);

    useImperativeHandle(ref, () => ({
      isExporting: () => exporting,
      exportImage,
    }), [exporting, exportImage]);

    return null;
  }
);
