import type { Plugin } from "vite";
import { REALTIME_VOICES } from "./src/voicePreview";

const PREVIEW_PATH = "/api/voice-preview";

/**
 * Dev-only proxy: POST JSON { voice, text } → OpenAI speech audio/mpeg.
 * Requires OPENAI_API_KEY in the environment running `npm run dev`.
 */
export function voicePreviewPlugin(): Plugin {
  return {
    name: "mmm-voice-preview",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(PREVIEW_PATH) || req.method !== "POST") {
          next();
          return;
        }

        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as {
            voice?: string;
            text?: string;
          };

          const voice = String(body.voice || "").trim();
          const text = String(body.text || "").trim();
          if (!voice || !(REALTIME_VOICES as readonly string[]).includes(voice)) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: `Unsupported voice. Use one of: ${REALTIME_VOICES.join(", ")}` }));
            return;
          }
          if (!text || text.length > 500) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Provide text between 1 and 500 characters." }));
            return;
          }

          const apiKey = process.env.OPENAI_API_KEY;
          if (!apiKey) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Missing OPENAI_API_KEY in the vite dev server environment." }));
            return;
          }

          const upstream = await fetch("https://api.openai.com/v1/audio/speech", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              model: "gpt-4o-mini-tts",
              voice,
              input: text,
              response_format: "mp3"
            })
          });

          if (!upstream.ok) {
            const errText = await upstream.text();
            res.statusCode = upstream.status;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: errText || `Speech API failed (${upstream.status})` }));
            return;
          }

          const audio = Buffer.from(await upstream.arrayBuffer());
          res.statusCode = 200;
          res.setHeader("Content-Type", "audio/mpeg");
          res.setHeader("Cache-Control", "no-store");
          res.end(audio);
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : "Voice preview failed"
            })
          );
        }
      });
    }
  };
}
