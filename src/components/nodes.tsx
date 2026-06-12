import { Handle, Position, type NodeProps } from "@xyflow/react";

const hiddenHandleStyle = { opacity: 0, pointerEvents: "none" as const };

function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Top} style={hiddenHandleStyle} />
      <Handle type="source" position={Position.Bottom} style={hiddenHandleStyle} />
    </>
  );
}

export function CenterNode({ data }: NodeProps) {
  return (
    <div className="node-base node-center">
      {String(data.label)}
      <Handles />
    </div>
  );
}

export function BranchNode({ data }: NodeProps) {
  return (
    <div className={`node-base node-branch ${String(data.branchId)}`}>
      <span className="category">{String(data.category)}</span>
      {String(data.label)}
      <Handles />
    </div>
  );
}

export function LeafNode({ data }: NodeProps) {
  return (
    <div className={`node-base node-leaf${data.fresh ? " fresh" : ""}`} title={`score: ${data.similarity}`}>
      {String(data.label)}
      <Handles />
    </div>
  );
}

export function FloatingNode({ data }: NodeProps) {
  return (
    <div className="floating-drift">
      <div className="node-base node-floating">{String(data.label)}</div>
      <Handles />
    </div>
  );
}
