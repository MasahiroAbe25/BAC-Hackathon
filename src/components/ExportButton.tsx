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
}

// Headless component — must render inside <ReactFlow> to access useReactFlow().
// UI lives in the side panel; call exportImage() via a forwarded ref.
export const ExportButton = forwardRef<ExportHandle, Props>(
  function ExportButton({ nodeSizes, title, onExportingChange }, ref) {
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

        const PIXEL_RATIO = 2;
        const fullDataUrl = await toPng(rendererEl, {
          pixelRatio: PIXEL_RATIO,
          backgroundColor: "#fafafc",
          // パネルとコントロールをキャプチャから除外
          filter: (node) => {
            if (!(node instanceof HTMLElement)) return true;
            return (
              !node.classList.contains("react-flow__panel") &&
              !node.classList.contains("react-flow__controls")
            );
          },
        });

        driftEls.forEach((el) => (el.style.animationPlayState = ""));

        // フルキャプチャからコンテンツ領域だけをクロップ
        const img = new Image();
        img.src = fullDataUrl;
        await new Promise<void>((r) => {
          img.onload = () => r();
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
      } finally {
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
