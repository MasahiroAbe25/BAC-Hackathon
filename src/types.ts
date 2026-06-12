export type NodeType = "center" | "branch" | "leaf" | "floating";
export type Source = "mining" | "ken_dialogue";

export interface TreeNode {
  id: string;
  type: NodeType;
  label: string;
  tags?: string[];
  source?: Source;
  parentBranchId?: string | null;
  similarity?: number;
  createdAt: string;
}

export interface Branch {
  id: string;
  category: string;
  label: string;
  keywords: string[];
}

export interface Diagnosis {
  id: string;
  title: string;
  summary: string;
  branches: Branch[];
}

export interface TopicInput {
  label: string;
  tags: string[];
}
