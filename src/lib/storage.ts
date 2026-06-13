import type { TreeNode } from "../types";

const DIAGNOSIS_ID_KEY = "memory-tree:diagnosis-id";
const treeKey = (id: string) => `memory-tree:tree:${id}`;

export function saveDiagnosisId(id: string): void {
  try {
    localStorage.setItem(DIAGNOSIS_ID_KEY, id);
  } catch {
    // ignore: storage unavailable or full
  }
}

export function clearDiagnosisId(): void {
  try {
    localStorage.removeItem(DIAGNOSIS_ID_KEY);
  } catch {
    // ignore
  }
}

export function loadDiagnosisId(): string | null {
  try {
    return localStorage.getItem(DIAGNOSIS_ID_KEY);
  } catch {
    return null;
  }
}

export function saveTree(
  diagnosisId: string,
  treeNodes: TreeNode[],
  positions: Map<string, { x: number; y: number }>
): void {
  try {
    localStorage.setItem(
      treeKey(diagnosisId),
      JSON.stringify({
        treeNodes,
        positions: Object.fromEntries(positions),
      })
    );
  } catch {
    // ignore: storage unavailable or full
  }
}

export function clearTree(diagnosisId: string): void {
  try {
    localStorage.removeItem(treeKey(diagnosisId));
  } catch {
    // ignore
  }
}

export function loadTree(diagnosisId: string): {
  treeNodes: TreeNode[];
  positions: Map<string, { x: number; y: number }>;
} | null {
  try {
    const raw = localStorage.getItem(treeKey(diagnosisId));
    if (!raw) return null;
    const data = JSON.parse(raw);
    return {
      treeNodes: data.treeNodes ?? [],
      positions: new Map(Object.entries(data.positions ?? {})),
    };
  } catch {
    return null;
  }
}
