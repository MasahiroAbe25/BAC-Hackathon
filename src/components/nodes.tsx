import { Handle, Position, type NodeProps } from "@xyflow/react";

// Anchor both handles at the node centre so straight connectors run
// centre-to-centre and stay symmetric in every direction.
const centerHandleStyle = {
  opacity: 0,
  pointerEvents: "none" as const,
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
};

function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Top} style={centerHandleStyle} />
      <Handle type="source" position={Position.Bottom} style={centerHandleStyle} />
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
