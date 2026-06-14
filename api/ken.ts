import type { VercelRequest, VercelResponse } from "@vercel/node";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const GEMINI_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
];

function isValidKey(key: string | undefined): key is string {
  return Boolean(key && !key.startsWith("your_"));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }

  const openrouterKey = isValidKey(process.env.OPENROUTER_API_KEY)
    ? process.env.OPENROUTER_API_KEY!
    : "";
  const geminiKey = isValidKey(process.env.GEMINI_API_KEY)
    ? process.env.GEMINI_API_KEY!
    : "";
  const model = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";

  if (!openrouterKey && !geminiKey) {
    return res.status(503).json({ error: "no_api_key" });
  }

  const { system = "", messages = [], maxTokens } = req.body as {
    system?: string;
    messages?: { role: string; content: string }[];
    maxTokens?: number;
  };
  const baseMessages = [{ role: "system", content: system }, ...messages];

  // 1. OpenRouter を試みる
  if (openrouterKey) {
    const orRes = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${openrouterKey}`,
      },
      body: JSON.stringify({ model, max_tokens: maxTokens ?? 1024, messages: baseMessages }),
    });
    if (orRes.ok) {
      const data = await orRes.json();
      return res.status(200).json(data);
    }
    console.warn(`[ken-api] OpenRouter ${orRes.status} → Gemini にフォールバック`);
  }

  // 2. Gemini フォールバックチェーン
  if (geminiKey) {
    for (const geminiModel of GEMINI_MODELS) {
      const gemRes = await fetch(GEMINI_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${geminiKey}`,
        },
        body: JSON.stringify({
          model: geminiModel,
          max_tokens: maxTokens ?? 1024,
          messages: baseMessages,
        }),
      });

      if (gemRes.ok) {
        const data = await gemRes.json();
        return res.status(200).json(data);
      }

      const errData = await gemRes.json().catch(() => ({}));
      const status = gemRes.status;

      // 認証エラーはキー自体が無効なので即停止
      if (status === 401 || status === 403) {
        console.error(`[ken-api] Gemini 認証エラー ${status}`);
        return res.status(status).json(errData);
      }

      // 429・404・5xx は次のモデルへ
      console.warn(`[ken-api] Gemini ${geminiModel} ${status} → 次のモデルへフォールバック`);
    }
  }

  return res.status(503).json({ error: "api_limit_exceeded_no_fallback" });
}
