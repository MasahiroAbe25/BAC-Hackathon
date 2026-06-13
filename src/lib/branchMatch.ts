import type { Branch, TopicInput, TreeNode } from "../types";

export interface MatchResult {
  branchId: string | null;
  score: number;
  scores: Record<string, number>;
}

const THRESHOLD = 0.5;

export function overlapCoefficient(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const ta of setA) {
    let matched = false;
    for (const kb of setB) {
      // 完全一致 or 部分一致（どちらか一方が他方を含む）
      if (ta === kb || ta.includes(kb) || kb.includes(ta)) {
        matched = true;
        break;
      }
    }
    if (matched) inter += 1;
  }
  return inter / Math.min(setA.size, setB.size);
}

export function matchBranch(topic: TopicInput, branches: Branch[]): MatchResult {
  let best: { branchId: string | null; score: number } = { branchId: null, score: 0 };
  const scores: Record<string, number> = {};
  for (const branch of branches) {
    const score = overlapCoefficient(topic.tags, branch.keywords);
    scores[branch.id] = score;
    if (score > best.score) {
      best = { branchId: branch.id, score };
    }
  }
  if (best.score >= THRESHOLD) {
    return { branchId: best.branchId, score: best.score, scores };
  }
  // ベストエフォート: 完全無関係(score=0)でなければ最も近いブランチへ接続
  if (best.score > 0 && best.branchId !== null) {
    return { branchId: best.branchId, score: best.score, scores };
  }
  return { branchId: null, score: 0, scores };
}

let seq = 0;

export function topicToNode(
  topic: TopicInput,
  branches: Branch[],
  source: "mining" | "ken_dialogue"
): TreeNode {
  const result = matchBranch(topic, branches);

  // ドメイン辞書由来のカテゴリを補完的に利用する:
  // Overlap係数では閾値に届かないが、辞書語のcategoryがブランチのcategoryと
  // 一致する場合は、そのブランチへ接続する(あくまで上書き・補完として動作)。
  let branchId = result.branchId;
  let similarity = result.score;
  if (!branchId && topic.domainTerms && topic.domainTerms.length > 0) {
    const byWeight = [...topic.domainTerms].sort((a, b) => b.weight - a.weight);
    for (const hit of byWeight) {
      if (!hit.category) continue;
      const matched = branches.find((branch) => branch.category === hit.category);
      if (matched) {
        branchId = matched.id;
        similarity = Math.max(similarity, result.scores[matched.id] ?? 0);
        break;
      }
    }
  }

  seq += 1;
  return {
    id: `topic-${Date.now()}-${seq}`,
    type: branchId ? "leaf" : "floating",
    label: topic.label,
    tags: topic.tags,
    source,
    parentBranchId: branchId,
    similarity,
    createdAt: new Date().toISOString(),
  };
}
