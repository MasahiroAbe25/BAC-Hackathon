import type { TopicInput } from "../types";

interface KuromojiToken {
  surface_form: string;
  pos: string;
  pos_detail_1: string;
  basic_form: string;
}

interface KuromojiTokenizer {
  tokenize: (text: string) => KuromojiToken[];
}

declare global {
  interface Window {
    kuromoji?: {
      builder: (opts: { dicPath: string }) => {
        build: (cb: (err: Error | null, tokenizer: KuromojiTokenizer) => void) => void;
      };
    };
  }
}

let tokenizerPromise: Promise<KuromojiTokenizer> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(script);
  });
}

export function getTokenizer(): Promise<KuromojiTokenizer> {
  if (!tokenizerPromise) {
    tokenizerPromise = (async () => {
      if (!window.kuromoji) {
        await loadScript("/kuromoji/kuromoji.js");
      }
      if (!window.kuromoji) throw new Error("kuromoji failed to load");
      return new Promise<KuromojiTokenizer>((resolve, reject) => {
        window.kuromoji!.builder({ dicPath: "/kuromoji/dict" }).build((err, tokenizer) => {
          if (err) reject(err);
          else resolve(tokenizer);
        });
      });
    })();
  }
  return tokenizerPromise;
}

const STOPWORDS = new Set([
  "こと", "もの", "ところ", "それ", "これ", "あれ", "とき", "ため", "よう",
  "さん", "たち", "の", "ん", "そう", "どこ", "みたい", "感じ", "気", "自分",
  "今", "前", "後", "中", "人", "何", "私", "僕", "一", "二", "三",
  "勉強", "やり方", "経験", "大事", "好き", "最近", "得意", "苦手", "もと",
  "いま", "とき", "場合", "結果", "理由", "意味", "方法", "部分", "全体",
  "みんな", "あと", "ほか", "毎日", "今日", "昨日", "明日",
]);

function isContentNoun(token: KuromojiToken): boolean {
  if (token.pos !== "名詞") return false;
  if (["非自立", "代名詞", "数", "接尾", "副詞可能"].includes(token.pos_detail_1)) return false;
  const surface = token.surface_form;
  if (surface.length < 2 && !/^[A-Za-z]+$/.test(surface)) return false;
  if (STOPWORDS.has(surface)) return false;
  return true;
}

/**
 * Tokenize free text, extract nouns / proper nouns, rank by frequency,
 * and normalize into { label, tags }.
 */
export async function mineText(text: string): Promise<TopicInput | null> {
  const tokenizer = await getTokenizer();
  const tokens = tokenizer.tokenize(text);

  const freq = new Map<string, number>();
  const compounds: string[][] = [];
  let current: string[] = [];

  for (const token of tokens) {
    if (isContentNoun(token)) {
      const word = token.surface_form;
      freq.set(word, (freq.get(word) ?? 0) + 1);
      current.push(word);
    } else {
      if (current.length >= 2) compounds.push(current);
      current = [];
    }
  }
  if (current.length >= 2) compounds.push(current);

  if (freq.size === 0) return null;

  // 複合名詞(連続する名詞の結合)もタグに含める。
  // diagnoses.jsonのkeywordsには「仮説検証」のような複合語が多いため。
  // 構成語そのものはノイズになるため除外する。
  for (const parts of compounds) {
    const joined = parts.join("");
    if (joined.length <= 12) {
      freq.set(joined, (freq.get(joined) ?? 0) + 2);
      for (const part of parts) {
        freq.delete(part);
      }
    }
  }

  const ranked = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word)
    .slice(0, 10);

  const labelSource = compounds[0]?.join("") ?? ranked.slice(0, 2).join("・");
  const label = labelSource.length > 14 ? `${labelSource.slice(0, 14)}…` : labelSource;

  return { label, tags: ranked };
}
