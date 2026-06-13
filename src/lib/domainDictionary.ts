/**
 * ドメイン辞書(カスタム用語辞書)
 *
 * kuromojiの標準IPADICでは複数語に分割されてしまう、就活・自己分析の文脈で
 * よく使う複合語・スラングを「1つのキーワード」として認識させるための辞書です。
 * IPADIC本体は変更せず、抽出処理の前段でこの辞書を優先適用します。
 *
 * ▼ 語を増やしたいとき
 *   下の DOMAIN_DICTIONARY 配列に { term, category?, weight? } を追加するだけで
 *   キーワード認識に反映されます(再ビルド/再読込で有効)。
 *   - term:     認識させたい表記そのまま(例: "推し活")
 *   - category: ノードのカテゴリ分類のヒント(任意)
 *   - weight:   頻度ランキングでの重み(任意・既定1。大きいほど上位に来やすい)
 */

export interface DomainTerm {
  term: string;
  category?: string;
  weight?: number;
}

export const DOMAIN_DICTIONARY: DomainTerm[] = [
  { term: "推し活", category: "興味", weight: 2 },
  { term: "二刀流", category: "強み", weight: 2 },
  { term: "ガクチカ", category: "就活", weight: 2 },
  { term: "自己分析", category: "就活", weight: 2 },
  { term: "就活軸", category: "就活", weight: 2 },
  { term: "自己PR", category: "就活", weight: 2 },
  { term: "業界研究", category: "就活", weight: 1.5 },
  { term: "企業研究", category: "就活", weight: 1.5 },
  { term: "逆求人", category: "就活", weight: 1.5 },
  { term: "長期インターン", category: "就活", weight: 1.5 },
  { term: "サマーインターン", category: "就活", weight: 1.5 },
  { term: "課題解決", category: "強み", weight: 1.5 },
  { term: "仮説検証", category: "強み", weight: 1.5 },
  { term: "巻き込み力", category: "強み", weight: 1.5 },
  { term: "リーダーシップ", category: "強み", weight: 1.5 },
];

export interface DomainMatch {
  term: string;
  category?: string;
  weight: number;
  start: number;
  end: number;
}

/**
 * 入力テキストをドメイン辞書で走査し、一致した語を返す。
 *
 * - 最長一致を優先する(「推し活」と「推し」が両方辞書にあれば「推し活」を採用)
 * - 一度マッチした文字範囲は再利用しない(重複・部分一致の二重カウントを防ぐ)
 * - 同じ語が複数回出現した場合は出現回数ぶん返す
 */
export function scanDomainTerms(text: string): DomainMatch[] {
  // 長い語から先に試すことで最長一致を担保する。
  const terms = [...DOMAIN_DICTIONARY].sort((a, b) => b.term.length - a.term.length);
  const consumed = new Array<boolean>(text.length).fill(false);
  const matches: DomainMatch[] = [];

  for (const entry of terms) {
    if (!entry.term) continue;
    let from = 0;
    let index = text.indexOf(entry.term, from);
    while (index !== -1) {
      const end = index + entry.term.length;
      let overlaps = false;
      for (let i = index; i < end; i += 1) {
        if (consumed[i]) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps) {
        for (let i = index; i < end; i += 1) consumed[i] = true;
        matches.push({
          term: entry.term,
          category: entry.category,
          weight: entry.weight ?? 1,
          start: index,
          end,
        });
      }
      from = index + 1;
      index = text.indexOf(entry.term, from);
    }
  }

  return matches.sort((a, b) => a.start - b.start);
}
