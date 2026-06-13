import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";
import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// Gemini の OpenAI 互換エンドポイント — レスポンス形式が同じなので ken.ts 側の変更不要
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const GEMINI_DEFAULT_MODEL = "gemini-3.1-flash-lite";

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

function kenApiPlugin(): Plugin {
  const dotEnv = readDotEnv();

  const openrouterKey = isValidKey(dotEnv.OPENROUTER_API_KEY)
    ? dotEnv.OPENROUTER_API_KEY
    : isValidKey(process.env.OPENROUTER_API_KEY)
      ? process.env.OPENROUTER_API_KEY
      : "";
  const geminiKey = isValidKey(dotEnv.GEMINI_API_KEY)
    ? dotEnv.GEMINI_API_KEY
    : isValidKey(process.env.GEMINI_API_KEY)
      ? process.env.GEMINI_API_KEY
      : "";
  const model = dotEnv.OPENROUTER_MODEL || process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";

  return {
    name: "ken-api",
    configureServer(server) {
      const log = server.config.logger;
      if (!openrouterKey && !geminiKey) {
        log.warn("[ken-api] APIキーが見つかりません。デモモードで動作します");
      } else if (openrouterKey) {
        log.info(`[ken-api] OpenRouter有効 (model: ${model})${geminiKey ? " / Geminiフォールバック有効" : ""}`);
      } else {
        log.info(`[ken-api] Gemini APIのみ有効 (model: ${GEMINI_DEFAULT_MODEL})`);
      }

      server.middlewares.use("/api/ken", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: "method not allowed" }));
          return;
        }
        if (!openrouterKey && !geminiKey) {
          res.statusCode = 503;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "no_api_key" }));
          return;
        }

        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", async () => {
          try {
            const { system = "", messages = [], maxTokens } = JSON.parse(body);
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

              // 成功時はそのまま返す。エラー時は Gemini へフォールバック
              if (orRes.ok) {
                const data = await orRes.json();
                res.statusCode = orRes.status;
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify(data));
                return;
              }

              log.warn(`[ken-api] OpenRouter ${orRes.status} → Gemini にフォールバック`);
            }

            // 2. Gemini フォールバック
            if (geminiKey) {
              const gemRes = await fetch(GEMINI_URL, {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  authorization: `Bearer ${geminiKey}`,
                },
                body: JSON.stringify({
                  model: GEMINI_DEFAULT_MODEL,
                  max_tokens: maxTokens ?? 1024,
                  messages: baseMessages,
                }),
              });
              const data = await gemRes.json();
              if (!gemRes.ok) {
                log.error(`[ken-api] Gemini ${gemRes.status}: ${JSON.stringify(data)}`);
              }
              res.statusCode = gemRes.status;
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify(data));
              return;
            }

            // どちらも使えない
            res.statusCode = 503;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "api_limit_exceeded_no_fallback" }));
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
