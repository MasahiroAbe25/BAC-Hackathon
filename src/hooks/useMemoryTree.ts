import { useCallback, useMemo, useRef, useState } from "react";
import type { Diagnosis, TopicInput, TreeNode, Source } from "../types";
import { topicToNode } from "../lib/branchMatch";
import { computeLayout, type NodeSize } from "../lib/layout";
import { loadTree, saveTree, clearTree } from "../lib/storage";

export interface AddResult {
  node: TreeNode;
  branchLabel: string | null;
}

export interface LayoutSizes {
  root?: NodeSize;
  branches?: Map<string, NodeSize>;
}

export function useMemoryTree(
  diagnosis: Diagnosis,
  getSizes?: () => LayoutSizes | undefined
) {
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>(
    () => loadTree(diagnosis.id)?.treeNodes ?? []
  );
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(
    () => loadTree(diagnosis.id)?.positions ?? new Map()
  );
  // useRef initial values are only used on the first render; subsequent renders ignore them.
  // loadTree is a fast synchronous read, so multiple calls are acceptable.
  const fixedRef = useRef<Map<string, { x: number; y: number }>>(
    loadTree(diagnosis.id)?.positions ?? new Map()
  );
  const nodesRef = useRef<TreeNode[]>(
    loadTree(diagnosis.id)?.treeNodes ?? []
  );

  const branchIndexById = useMemo(() => {
    const map = new Map<string, number>();
    diagnosis.branches.forEach((branch, index) => map.set(branch.id, index));
    return map;
  }, [diagnosis]);

  const addTopics = useCallback(
    (topics: TopicInput[], source: Source): AddResult[] => {
      const existingLabels = new Set(
        nodesRef.current.map((n) => n.label.trim().toLowerCase())
      );
      const added = topics
        .filter((topic) => topic.label && topic.tags.length > 0)
        .filter((topic) => !existingLabels.has(topic.label.trim().toLowerCase()))
        .map((topic) => topicToNode(topic, diagnosis.branches, source));
      if (added.length === 0) return [];

      const next = [...nodesRef.current, ...added];
      nodesRef.current = next;

      const layout = computeLayout(next, fixedRef.current, branchIndexById, getSizes?.());
      const newPositions = new Map<string, { x: number; y: number }>();
      for (const positioned of layout) {
        newPositions.set(positioned.id, { x: positioned.x, y: positioned.y });
        fixedRef.current.set(positioned.id, { x: positioned.x, y: positioned.y });
      }

      setTreeNodes(next);
      setPositions(newPositions);
      saveTree(diagnosis.id, next, newPositions);

      return added.map((node) => {
        const branch = diagnosis.branches.find((b) => b.id === node.parentBranchId);
        return { node, branchLabel: branch?.label ?? null };
      });
    },
    [diagnosis, branchIndexById, getSizes]
  );

  const resetTree = useCallback(() => {
    nodesRef.current = [];
    fixedRef.current = new Map();
    setTreeNodes([]);
    setPositions(new Map());
    clearTree(diagnosis.id);
  }, [diagnosis.id]);

  return { treeNodes, positions, addTopics, resetTree };
}
