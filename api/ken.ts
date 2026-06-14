import type { VercelRequest, VercelResponse } from "@vercel/node";

interface Message {
  role: string;
  content: string;
}

function isValidKey(key: string | undefined): key is string {
  return Boolean(key && !key.startsWith("your_"));
}

/** カンマ区切り文字列をモデル配列に変換。未設定時はデフォルト値を使用 */
function parseModels(envVal: string | undefined, defaultModel: string): string[] {
  if (!envVal) return [defaultModel];
  return envVal.split(",").map((s) => s.trim()).filter(Boolean);
}

/** OpenAI互換エンドポイントに対してモデルリストを順に試す */
async function tryWithModels(
  url: string,
  key: string,
  models: string[],
  messages: Message[],
  maxTokens: number
): Promise<unknown | null> {
  for (const model of models) {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
    });
    if (r.ok) return r.json();
    // 認証エラー・不正リクエストはキーまたはモデル名が無効なので即停止
    if (r.status === 400 || r.status === 401 || r.status === 403) return null;
    // 429・5xx は次のモデルへ
  }
  return null;
}

/** Anthropic専用 (APIフォーマットが異なるため別関数) */
async function tryAnthropicWithModels(
  key: string,
  models: string[],
  messages: Message[],
  maxTokens: number
): Promise<unknown | null> {
  const system = messages.find((m) => m.role === "system")?.content;
  const userMessages = messages.filter((m) => m.role !== "system");

  for (const model of models) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages: userMessages,
      }),
    });

    if (r.ok) {
      const raw = (await r.json()) as {
        content?: { text: string }[];
        stop_reason?: string;
        usage?: { input_tokens: number; output_tokens: number };
      };
      // OpenAI互換形式に変換して返す
      return {
        choices: [
          {
            message: { role: "assistant", content: raw.content?.[0]?.text ?? "" },
            finish_reason: raw.stop_reason ?? "stop",
          },
        ],
        usage: {
          prompt_tokens: raw.usage?.input_tokens,
          completion_tokens: raw.usage?.output_tokens,
        },
      };
    }

    if (r.status === 400 || r.status === 401 || r.status === 403) return null;
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    const { system = "", messages = [], maxTokens } = req.body as {
      system?: string;
      messages?: Message[];
      maxTokens?: number;
    };
    const tokens = maxTokens ?? 1024;
    const baseMessages = [{ role: "system", content: system }, ...messages];

    // OpenAI互換プロバイダー (優先順に試行、各プロバイダーでモデルリストを順に試す)
    const compatProviders = [
      {
        url: "https://openrouter.ai/api/v1/chat/completions",
        key: process.env.OPENROUTER_API_KEY,
        models: parseModels(process.env.OPENROUTER_MODEL, "openai/gpt-4o-mini"),
      },
      {
        url: "https://api.openai.com/v1/chat/completions",
        key: process.env.OPENAI_API_KEY,
        models: parseModels(process.env.OPENAI_MODEL, "gpt-4o-mini"),
      },
      {
        url: "https://api.groq.com/openai/v1/chat/completions",
        key: process.env.GROQ_API_KEY,
        models: parseModels(process.env.GROQ_MODEL, "llama-3.3-70b-versatile"),
      },
      {
        url: "https://api.mistral.ai/v1/chat/completions",
        key: process.env.MISTRAL_API_KEY,
        models: parseModels(process.env.MISTRAL_MODEL, "mistral-small-latest"),
      },
      {
        url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        key: process.env.GEMINI_API_KEY,
        models: parseModels(process.env.GEMINI_MODEL, "gemini-2.5-flash"),
      },
    ];

    const hasAnyKey =
      compatProviders.some((p) => isValidKey(p.key)) ||
      isValidKey(process.env.ANTHROPIC_API_KEY);

    if (!hasAnyKey) {
      return res.status(503).json({ error: "no_api_key" });
    }

    for (const p of compatProviders) {
      if (!isValidKey(p.key)) continue;
      const data = await tryWithModels(p.url, p.key, p.models, baseMessages, tokens);
      if (data) return res.status(200).json(data);
    }

    // Anthropic (独自フォーマットのため専用処理)
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (isValidKey(anthropicKey)) {
      const models = parseModels(process.env.ANTHROPIC_MODEL, "claude-3-5-haiku-20241022");
      const data = await tryAnthropicWithModels(anthropicKey, models, baseMessages, tokens);
      if (data) return res.status(200).json(data);
    }

    return res.status(503).json({ error: "api_limit_exceeded_no_fallback" });
  } catch {
    return res.status(500).json({ error: "internal_server_error" });
  }
}
