import { useCallback, useMemo, useRef, useState } from "react";
import type { Diagnosis, TopicInput, TreeNode, Source } from "../types";
import { topicToNode } from "../lib/branchMatch";
import { computeLayout } from "../lib/layout";

export interface AddResult {
  node: TreeNode;
  branchLabel: string | null;
}

export function useMemoryTree(diagnosis: Diagnosis) {
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const fixedRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const nodesRef = useRef<TreeNode[]>([]);

  const branchIndexById = useMemo(() => {
    const map = new Map<string, number>();
    diagnosis.branches.forEach((branch, index) => map.set(branch.id, index));
    return map;
  }, [diagnosis]);

  const addTopics = useCallback(
    (topics: TopicInput[], source: Source): AddResult[] => {
      const added = topics
        .filter((topic) => topic.label && topic.tags.length > 0)
        .map((topic) => topicToNode(topic, diagnosis.branches, source));
      if (added.length === 0) return [];

      const next = [...nodesRef.current, ...added];
      nodesRef.current = next;

      const layout = computeLayout(next, fixedRef.current, branchIndexById);
      const newPositions = new Map<string, { x: number; y: number }>();
      for (const positioned of layout) {
        newPositions.set(positioned.id, { x: positioned.x, y: positioned.y });
        fixedRef.current.set(positioned.id, { x: positioned.x, y: positioned.y });
      }

      setTreeNodes(next);
      setPositions(newPositions);

      return added.map((node) => {
        const branch = diagnosis.branches.find((b) => b.id === node.parentBranchId);
        return { node, branchLabel: branch?.label ?? null };
      });
    },
    [diagnosis, branchIndexById]
  );

  return { treeNodes, positions, addTopics };
}
