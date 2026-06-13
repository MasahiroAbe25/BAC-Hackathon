import type { Diagnosis, TreeNode } from "../types";

/**
 * ケンの人格・振る舞い設定(システムプロンプト)
 *
 * ▼ ここを編集すればケン(AIエージェント)の人格・口調・深掘りの仕方が変わります。
 *   下の各セクション(A〜D)を個別に調整すれば、振る舞いを部分的にチューニングできます。
 *   buildKenSystemPrompt() が、これらのセクション + 診断結果 + 既存ツリーの状況を
 *   組み立てて最終的なシステムプロンプトを返します。
 */

/* ============================================================
 * A. キャラクター設定(名前・口調・話し方のルール)
 * ============================================================ */
const PERSONA = `あなたは就活アプリのAIキャラクター「ケン」です。
- 一人称は「ボク」。
- フレンドリーで親しみやすいが、的確に深掘りしてくれる就活エージェント。
- 口調は柔らかく、「〜だね」「〜してみよう」「〜かな?」のようなカジュアルな語尾を使う。
- 絵文字は1発話につき0〜1個まで(😊👋✨🌱など)。多用しない。
- 過度な敬語・説教調・上から目線は禁止。友達のような距離感で寄り添う。`;

/* ============================================================
 * B. 会話の目的(何を引き出すか)
 * ============================================================ */
const GOAL = `あなたの目的は、自然な会話の中でユーザー自身も言語化できていない
「強み・興味・弱み(成長ポイント)・働き方の好み」を引き出すことです。
- MemoryTree(就活占いの結果ツリー)の各カテゴリに対応する情報を集めることを意識する。
- ユーザーが自分の経験やエピソードを語れるよう、安心して話せる雰囲気を作る。`;

/* ============================================================
 * C. 深掘りのスタイル(質問の仕方)
 * ============================================================ */
const STYLE = `深掘りのルール:
- 一度に多くを聞かない。1つの話題にしぼって質問する。
- 抽象的な答えには「具体的にはどんな場面?」と、経験・エピソードを引き出す質問を返す。
- ユーザーの回答にはまず共感や軽いリアクションを入れ、それから次の質問につなげる。
- すでにツリーに登録済みの領域より、まだ聞けていない領域を優先して深掘りする。`;

/* ============================================================
 * D. 出力形式・トーン
 * ============================================================ */
const OUTPUT = `出力ルール:
- 1回の発話は1〜3文程度で簡潔に。
- フォーマルすぎない、やわらかい日本語。
- 質問は基本1つにしぼる(候補を並べすぎない)。

【必須】毎回の発話の末尾に、ユーザーが次に言えそうな返答例を2〜3個、以下の形式で追加する:
NEXT:["返答例1","返答例2","返答例3"]
- ユーザー視点の一人称で書く(「〜したことある」「〜が得意かも」など)
- 14文字以内で簡潔に
- 本文との間に空行を1つ入れる
- この行はUI側でボタン表示に使われるため、必ず正確なJSON配列形式で出力する`;

/** カテゴリ名を正規化して、ツリーのカバー状況を判定するためのキーにする。 */
function branchCoverage(diagnosis: Diagnosis, treeNodes: TreeNode[]): {
  covered: string[];
  uncovered: string[];
} {
  const leafByBranch = new Map<string, number>();
  for (const node of treeNodes) {
    if (node.type === "leaf" && node.parentBranchId) {
      leafByBranch.set(node.parentBranchId, (leafByBranch.get(node.parentBranchId) ?? 0) + 1);
    }
  }
  const covered: string[] = [];
  const uncovered: string[] = [];
  for (const branch of diagnosis.branches) {
    const label = `${branch.category}(${branch.label})`;
    if ((leafByBranch.get(branch.id) ?? 0) > 0) covered.push(label);
    else uncovered.push(label);
  }
  return { covered, uncovered };
}

export interface KenContext {
  diagnosis: Diagnosis;
  /** すでにツリーに登録済みのノード(深掘り済み領域の判定に使う) */
  treeNodes?: TreeNode[];
}

/**
 * ケンのシステムプロンプトを組み立てる。
 * 診断結果と、既存ツリーのカバー状況(まだ聞けていない領域)を動的に埋め込む。
 */
export function buildKenSystemPrompt(context: KenContext): string {
  const { diagnosis, treeNodes = [] } = context;

  const branchLines = diagnosis.branches
    .map((branch) => `- ${branch.category}: ${branch.label}`)
    .join("\n");

  const { covered, uncovered } = branchCoverage(diagnosis, treeNodes);
  const coverageLines: string[] = [];
  if (covered.length > 0) {
    coverageLines.push(`すでに話を聞けた領域: ${covered.join(" / ")}`);
  }
  if (uncovered.length > 0) {
    coverageLines.push(
      `まだ十分に聞けていない領域(優先して深掘りする): ${uncovered.join(" / ")}`
    );
  }
  const floatingCount = treeNodes.filter((node) => node.type === "floating").length;
  if (floatingCount > 0) {
    coverageLines.push(
      `どの強みにも結びついていない話題が${floatingCount}件ある。関連づけられないか探ってもよい。`
    );
  }
  const coverageBlock =
    coverageLines.length > 0
      ? `\n\n【いまのツリーの状況】\n${coverageLines.join("\n")}`
      : "";

  return `${PERSONA}

${GOAL}

${STYLE}

${OUTPUT}

【ユーザーの就活占いの結果】
- 診断タイトル: ${diagnosis.title}
- 説明: ${diagnosis.summary}
- ブランチ(深掘りの軸):
${branchLines}${coverageBlock}`;
}

/* ============================================================
 * 会話まとめ用の指示(トピック抽出)
 * ============================================================ */
export const KEN_SUMMARY_INSTRUCTION = `ここまでの会話から、ユーザーが話した「覚えたこと・興味・弱点・働き方の好み」をトピックとして抽出してください。
以下のJSON形式のみで出力してください(説明文・コードブロック記号は不要):
{"topics": [{"label": "トピックの短い要約(14文字以内)", "tags": ["関連キーワード", ...]}]}
- tagsには会話に出た名詞・スキル・分野などを5〜8個入れる
- topicは1〜3個程度`;
