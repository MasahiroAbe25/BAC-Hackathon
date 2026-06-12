import type { Diagnosis, TopicInput } from "../types";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function buildSystemPrompt(diagnosis: Diagnosis): string {
  const branchLines = diagnosis.branches
    .map((branch) => `- ${branch.category}: ${branch.label}`)
    .join("\n");
  return `あなたは就活アプリのAIキャラクター「ケン」です。フレンドリーで親しみやすく、絵文字や「〜だね」「〜してみよう」のような柔らかい語尾で話します。

ユーザーは就活占いで次の診断結果を受け取りました:
- 診断タイトル: ${diagnosis.title}
- 説明: ${diagnosis.summary}
- ブランチ:
${branchLines}

あなたの役割は、この診断結果の文脈に沿って、ユーザーの「最近覚えたこと・興味があること・苦手なこと」を引き出す質問を1つずつ投げかけることです。
- 1回の発話は短く(2〜3文以内)
- ユーザーの回答に軽く共感してから、次の質問につなげる
- 具体的なエピソードやキーワードが出るように深掘りする`;
}

const SUMMARY_INSTRUCTION = `ここまでの会話から、ユーザーが話した「覚えたこと・興味・弱点」をトピックとして抽出してください。
以下のJSON形式のみで出力してください(説明文・コードブロック記号は不要):
{"topics": [{"label": "トピックの短い要約(14文字以内)", "tags": ["関連キーワード", ...]}]}
- tagsには会話に出た名詞・スキル・分野などを5〜8個入れる
- topicは1〜3個程度`;

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
  if (response.status === 503) return null; // APIキー未設定 → モックへ
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
  "教えてくれてありがとう!😊 他にも話したいことがあったら聞かせてね。なければ「まとめてもらう」を押してみよう!",
];

function mockReply(turnCount: number): string {
  return MOCK_QUESTIONS[Math.min(turnCount, MOCK_QUESTIONS.length - 1)];
}

export interface KenReply {
  text: string;
  mock: boolean;
}

export async function kenChat(
  diagnosis: Diagnosis,
  messages: ChatMessage[]
): Promise<KenReply> {
  const system = buildSystemPrompt(diagnosis);
  try {
    const text = await callKenApi(system, ensureLeadingUser(messages), 512);
    if (text !== null) return { text, mock: false };
  } catch (error) {
    console.warn("ken api failed, falling back to mock:", error);
  }
  const assistantTurns = messages.filter((message) => message.role === "assistant").length;
  return { text: mockReply(assistantTurns), mock: true };
}

export async function kenSummarize(
  diagnosis: Diagnosis,
  messages: ChatMessage[]
): Promise<{ topics: TopicInput[]; mock: boolean }> {
  const system = buildSystemPrompt(diagnosis);
  const summaryMessages: ChatMessage[] = [
    ...ensureLeadingUser(messages),
    { role: "user", content: SUMMARY_INSTRUCTION },
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
  if (messages.length > 0 && messages[0].role === "assistant") {
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
