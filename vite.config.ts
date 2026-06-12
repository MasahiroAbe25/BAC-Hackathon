import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

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
  const apiKey = isValidKey(dotEnv.OPENROUTER_API_KEY)
    ? dotEnv.OPENROUTER_API_KEY
    : isValidKey(process.env.OPENROUTER_API_KEY)
      ? process.env.OPENROUTER_API_KEY
      : "";
  const model = dotEnv.OPENROUTER_MODEL || process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
  return {
    name: "ken-api",
    configureServer(server) {
      if (!apiKey) {
        server.config.logger.warn("[ken-api] OPENROUTER_API_KEYが見つからないため、ケンはデモモードで動作します");
      } else {
        server.config.logger.info(`[ken-api] OpenRouter有効 (model: ${model})`);
      }
      server.middlewares.use("/api/ken", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: "method not allowed" }));
          return;
        }
        if (!apiKey) {
          res.statusCode = 503;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "no_api_key" }));
          return;
        }
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", async () => {
          try {
            const { system = "", messages = [], maxTokens } = JSON.parse(body);
            const response = await fetch(OPENROUTER_URL, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                model,
                max_tokens: maxTokens ?? 1024,
                messages: [{ role: "system", content: system }, ...messages],
              }),
            });
            const data = await response.json();
            res.statusCode = response.status;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(data));
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

export default defineConfig({
  plugins: [react(), kenApiPlugin()],
});
