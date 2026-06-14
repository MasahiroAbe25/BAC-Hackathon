import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";
import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** .envファイルを直接読む(シェル環境変数のプレースホルダーに上書きされないよう、.envを最優先にする) */
function readDotEnv(): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    const content = readFileSync(new URL(".env", import.meta.url), "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (value) result[key] = value;
    }
  } catch {
    // .envが無ければ無視
  }
  return result;
}

function isValidKey(key: string | undefined): key is string {
  return Boolean(key && !key.startsWith("your_"));
}

function getEnv(dotEnv: Record<string, string>, key: string): string | undefined {
  return dotEnv[key] || process.env[key];
}

function parseModels(val: string | undefined, defaultModel: string): string[] {
  if (!val) return [defaultModel];
  return val.split(",").map((s) => s.trim()).filter(Boolean);
}

async function tryWithModels(
  url: string,
  key: string,
  models: string[],
  messages: unknown[],
  maxTokens: number
): Promise<unknown | null> {
  for (const model of models) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
    });
    if (r.ok) return r.json();
    if (r.status === 400 || r.status === 401 || r.status === 403) return null;
  }
  return null;
}

async function tryAnthropicWithModels(
  key: string,
  models: string[],
  messages: { role: string; content: string }[],
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
      const raw = await r.json() as {
        content?: { text: string }[];
        stop_reason?: string;
        usage?: { input_tokens: number; output_tokens: number };
      };
      return {
        choices: [{ message: { role: "assistant", content: raw.content?.[0]?.text ?? "" }, finish_reason: raw.stop_reason ?? "stop" }],
        usage: { prompt_tokens: raw.usage?.input_tokens, completion_tokens: raw.usage?.output_tokens },
      };
    }
    if (r.status === 400 || r.status === 401 || r.status === 403) return null;
  }
  return null;
}

function kenApiPlugin(): Plugin {
  const dotEnv = readDotEnv();

  return {
    name: "ken-api",
    configureServer(server) {
      server.middlewares.use("/api/ken", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: "method not allowed" }));
          return;
        }

        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", async () => {
          try {
            const { system = "", messages = [], maxTokens } = JSON.parse(body);
            const tokens: number = maxTokens ?? 1024;
            const baseMessages = [{ role: "system", content: system }, ...messages];

            const compatProviders = [
              {
                url: "https://openrouter.ai/api/v1/chat/completions",
                key: getEnv(dotEnv, "OPENROUTER_API_KEY"),
                models: parseModels(getEnv(dotEnv, "OPENROUTER_MODEL"), "openai/gpt-4o-mini"),
              },
              {
                url: "https://api.openai.com/v1/chat/completions",
                key: getEnv(dotEnv, "OPENAI_API_KEY"),
                models: parseModels(getEnv(dotEnv, "OPENAI_MODEL"), "gpt-4o-mini"),
              },
              {
                url: "https://api.groq.com/openai/v1/chat/completions",
                key: getEnv(dotEnv, "GROQ_API_KEY"),
                models: parseModels(getEnv(dotEnv, "GROQ_MODEL"), "llama-3.3-70b-versatile"),
              },
              {
                url: "https://api.mistral.ai/v1/chat/completions",
                key: getEnv(dotEnv, "MISTRAL_API_KEY"),
                models: parseModels(getEnv(dotEnv, "MISTRAL_MODEL"), "mistral-small-latest"),
              },
              {
                url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
                key: getEnv(dotEnv, "GEMINI_API_KEY"),
                models: parseModels(getEnv(dotEnv, "GEMINI_MODEL"), "gemini-2.5-flash"),
              },
            ];

            const anthropicKey = getEnv(dotEnv, "ANTHROPIC_API_KEY");
            const hasAnyKey = compatProviders.some((p) => isValidKey(p.key)) || isValidKey(anthropicKey);

            if (!hasAnyKey) {
              res.statusCode = 503;
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify({ error: "no_api_key" }));
              return;
            }

            const sendJson = (status: number, data: unknown) => {
              res.statusCode = status;
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify(data));
            };

            for (const p of compatProviders) {
              if (!isValidKey(p.key)) continue;
              const data = await tryWithModels(p.url, p.key, p.models, baseMessages, tokens);
              if (data) { sendJson(200, data); return; }
            }

            if (isValidKey(anthropicKey)) {
              const models = parseModels(getEnv(dotEnv, "ANTHROPIC_MODEL"), "claude-3-5-haiku-20241022");
              const data = await tryAnthropicWithModels(anthropicKey, models, baseMessages, tokens);
              if (data) { sendJson(200, data); return; }
            }

            sendJson(503, { error: "api_limit_exceeded_no_fallback" });
          } catch (error) {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: String(error) }));
          }
        });
      });
    },
  };
}

/**
 * kuromojiの辞書ファイル(*.dat.gz)を「素のgzipバイナリ」として返すプラグイン。
 *
 * Viteのdev静的サーバー(sirv)は拡張子`.gz`を見ると`Content-Encoding: gzip`を
 * 付けて返すことがある。するとブラウザが自動でgunzipし、kuromoji側のXHRには
 * 展開済みバイトが渡る → kuromojiがさらにgunzipしようとして
 * `invalid file signature` で失敗する。
 *
 * ここでは`/kuromoji/dict/*.dat.gz`へのリクエストを横取りし、
 * Content-Encodingを付けずに`application/octet-stream`としてそのまま返すことで
 * この二重展開を防ぐ。
 */
function kuromojiDictPlugin(): Plugin {
  const publicDir = join(dirname(fileURLToPath(import.meta.url)), "public");
  const serveRaw: Connect.NextHandleFunction = (req, res, next) => {
    const url = (req.url || "").split("?")[0];
    if (!url.startsWith("/kuromoji/dict/") || !url.endsWith(".dat.gz")) {
      next();
      return;
    }
    const filePath = normalize(join(publicDir, decodeURIComponent(url)));
    // ディレクトリトラバーサル防止
    if (!filePath.startsWith(join(publicDir, "kuromoji", "dict")) || !existsSync(filePath)) {
      next();
      return;
    }
    const data = readFileSync(filePath);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", String(statSync(filePath).size));
    // ブラウザに勝手にgunzipさせないため Content-Encoding は付けない
    res.removeHeader?.("Content-Encoding");
    res.setHeader("Cache-Control", "no-transform");
    res.end(data);
  };
  return {
    name: "kuromoji-dict-raw",
    configureServer(server) {
      // 他の静的ミドルウェアより前に処理する
      server.middlewares.use(serveRaw);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serveRaw);
    },
  };
}

export default defineConfig({
  plugins: [kuromojiDictPlugin(), react(), kenApiPlugin()],
});
