import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  // Startup log
  const possibleKeys = [
    'GEMINI_API_KEY',
    'VITE_GEMINI_API_KEY',
    'VITE_APP_ENGINE_TOKEN',
    'GOOGLE_API_KEY',
    'AI_KEY',
    'API_KEY',
    'GEMINI_TOKEN',
    'GOOGLE_AI_KEY'
  ];

  let activeKey = "";
  let keySource = "None";

  for (const envKeyName of possibleKeys) {
    const val = process.env[envKeyName];
    if (val) {
      // UNIVERSAL SELF-HEALING: Auto-strip quotes and whitespace
      const cleanKey = val.replace(/['"]+/g, '').trim();
      if (cleanKey.length > 10) {
        activeKey = cleanKey;
        keySource = envKeyName;
        break;
      }
    }
  }

  console.log(`[UMUHINZI AI] Backend starting...`);
  console.log(`[UMUHINZI AI] Security: Key Discovery ${activeKey ? 'SUCCESS (' + keySource + ')' : 'PENDING'}`);
  
  if (!activeKey) {
    console.warn("[UMUHINZI AI] WARNING: No Gemini API key detected in Environment Variables.");
  }

  // API Routes
  app.get("/api/ai-config", (req, res) => {
    // Dynamic re-check with same cleaning logic as startup
    let currentKey = "";
    let currentSource = "None";
    for (const k of possibleKeys) {
      const val = process.env[k];
      if (val) {
        const clean = val.replace(/['"]+/g, '').trim();
        if (clean.length > 10) {
          currentKey = clean;
          currentSource = k;
          break;
        }
      }
    }

    res.json({ 
      apiKey: currentKey,
      status: currentKey ? "configured" : "missing",
      detectedSource: currentSource,
      instruction: currentKey ? "System Online" : "CRITICAL: Set GEMINI_API_KEY in your hosting dashboard and RE-DEPLOY."
    });
  });

  const isProd = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";

  if (!isProd) {
    // Only import vite in development to save memory/avoid crashes in prod environments
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    
    // Serve static files from the build output
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get("*all", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    } else {
      app.get("*all", (req, res) => {
        res.status(500).send("Build artifacts missing. Please run 'npm run build' first.");
      });
    }
  }

  // Bind to 0.0.0.0 for external access
  if (process.env.VERCEL !== "1") {
    app.listen(Number(PORT), "0.0.0.0", () => {
      console.log(`[UMUHINZI AI] Server running on port ${PORT} (${process.env.NODE_ENV || 'dev'} mode)`);
      console.log(`[UMUHINZI AI] AI config probe: http://localhost:${PORT}/api/ai-config`);
    });
  }

  return app;
}

const serverPromise = startServer().catch(err => {
  console.error("[UMUHINZI AI] Failed to initialize server:", err);
  process.exit(1);
});

export default serverPromise;
