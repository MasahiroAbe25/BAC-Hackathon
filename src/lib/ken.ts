import type { Diagnosis, TopicInput, TreeNode } from "../types";
import { buildKenSystemPrompt, KEN_SUMMARY_INSTRUCTION } from "./kenPersona";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

async function callKenApi(
  system: string,
  messages: ChatMessage[],
  maxTokens: number
): Promise<string | null> {
  const response = await fetch("/api/ken", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ system, messages, maxTokens }),
  });
  if (response.status === 503) {
    const data = await response.json().catch(() => ({}));
    if ((data as { error?: string }).error === "api_limit_exceeded_no_fallback") {
      // OpenRouter も Gemini も使えない状態 — 警告ログを出してモックへ
      throw new Error("ken api: both OpenRouter and Gemini are unavailable");
    }
    return null; // no_api_key → モックへ
  }
  if (!response.ok) {
    throw new Error(`ken api error: ${response.status}`);
  }
  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("unexpected ken api response");
  return text;
}

/* ---------- モックフォールバック(APIキー未設定時のデモ用) ---------- */

const MOCK_QUESTIONS = [
  "やっほー!ボクはケンだよ 👋 さっそくだけど、最近「これ覚えた!」って思ったことはあるかな?",
  "いいね、それすごく気になる!✨ ちなみに、最近ハマってることや興味がある分野はある?",
  "なるほどなるほど〜。じゃあ逆に、「これはちょっと苦手かも…」って思うことはあるかな?",
  "ちょっと聞いてもいい?学校やバイト・インターンで「自分が一番動いたな」って場面、何か思い浮かぶ?",
  "働くうえで「これだけは譲れない!」ってこと、ある? 場所でも時間でも雰囲気でも、なんでもOKだよ。",
  "逆に「こんな職場・仕事はちょっとキツいかも…」って思うのはどんなとき?",
  "就活のこと以外でもいいんだけど、最近いちばん「楽しかった!」って瞬間を教えてほしいな 😄",
  "もし時間もお金も関係なかったら、何に一番エネルギーを使いたい?",
  "チームで動くのと一人で集中するの、どっちがしっくりくる感じ?",
  "教えてくれてありがとう!😊 他にも話したいことがあったら聞かせてね。なければ「まとめてもらう」を押してみよう!",
];

function mockReply(turnCount: number): string {
  return MOCK_QUESTIONS[Math.min(turnCount, MOCK_QUESTIONS.length - 1)];
}

export interface KenReply {
  text: string;
  suggestions: string[];
  mock: boolean;
}

/** NEXT:[...] 行をテキストから抽出し、{text, suggestions} に分割する */
function splitSuggestions(raw: string): { text: string; suggestions: string[] } {
  const match = raw.match(/\nNEXT:(\[.*?\])\s*$/s);
  if (!match) return { text: raw.trim(), suggestions: [] };
  const text = raw.slice(0, match.index).trim();
  try {
    const suggestions = JSON.parse(match[1]);
    if (Array.isArray(suggestions) && suggestions.every((s) => typeof s === "string")) {
      return { text, suggestions };
    }
  } catch {
    // パース失敗時は suggestions なしで返す
  }
  return { text, suggestions: [] };
}

export async function kenChat(
  diagnosis: Diagnosis,
  messages: ChatMessage[],
  treeNodes: TreeNode[] = []
): Promise<KenReply> {
  const system = buildKenSystemPrompt({ diagnosis, treeNodes });
  try {
    const raw = await callKenApi(system, ensureLeadingUser(messages), 600);
    if (raw !== null) {
      const { text, suggestions } = splitSuggestions(raw);
      return { text, suggestions, mock: false };
    }
  } catch (error) {
    console.warn("ken api failed, falling back to mock:", error);
  }
  const assistantTurns = messages.filter((message) => message.role === "assistant").length;
  return { text: mockReply(assistantTurns), suggestions: [], mock: true };
}

export async function kenSummarize(
  diagnosis: Diagnosis,
  messages: ChatMessage[],
  treeNodes: TreeNode[] = []
): Promise<{ topics: TopicInput[]; mock: boolean }> {
  const system = buildKenSystemPrompt({ diagnosis, treeNodes });
  const summaryMessages: ChatMessage[] = [
    ...ensureLeadingUser(messages),
    { role: "user", content: KEN_SUMMARY_INSTRUCTION },
  ];
  try {
    const text = await callKenApi(system, summaryMessages, 1024);
    if (text !== null) {
      const topics = parseTopics(text);
      if (topics.length > 0) return { topics, mock: false };
    }
  } catch (error) {
    console.warn("ken summarize failed, falling back to mock:", error);
  }
  return { topics: mockSummarize(messages), mock: true };
}

function ensureLeadingUser(messages: ChatMessage[]): ChatMessage[] {
  // Gemini 等は user メッセージが必須。空配列・先頭が assistant の場合にトリガーを挿入する
  if (messages.length === 0 || messages[0].role === "assistant") {
    return [{ role: "user", content: "(会話を始めてください)" }, ...messages];
  }
  return messages;
}

function parseTopics(text: string): TopicInput[] {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed.topics)) return [];
    return parsed.topics
      .filter(
        (topic: unknown): topic is TopicInput =>
          typeof topic === "object" &&
          topic !== null &&
          typeof (topic as TopicInput).label === "string" &&
          Array.isArray((topic as TopicInput).tags)
      )
      .map((topic: TopicInput) => ({
        label: topic.label.slice(0, 20),
        tags: topic.tags.filter((tag) => typeof tag === "string"),
      }));
  } catch {
    return [];
  }
}

/** モック時はユーザー発話をkuromojiでマイニングしてトピック化する */
function mockSummarize(messages: ChatMessage[]): TopicInput[] {
  const userText = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join("。");
  if (!userText.trim()) return [];
  return [{ label: "__MINE__", tags: [userText] }];
}
