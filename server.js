const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const fetchFn = global.fetch
  ? global.fetch.bind(global)
  : (...args) => import("node-fetch").then((mod) => mod.default(...args));

// Cargar variables de entorno desde .env
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    if (!process.env[key]) {
      process.env[key] = rest.join("=").trim();
    }
  }
}

const PORT = process.env.PORT || 3001;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = process.env.ASSISTANT_ID || process.env.OPENAI_ASSISTANT_ID;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "https://www.argentino.click,https://argentino.click,http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000;
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || 20;

if (!OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY env var.");
  process.exit(1);
}

if (!ASSISTANT_ID) {
  console.error("Missing ASSISTANT_ID env var (or OPENAI_ASSISTANT_ID).");
  process.exit(1);
}

const rateLimitStore = new Map();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.length > 0) {
    return forwardedFor.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

function isRateLimited(req) {
  const now = Date.now();
  const ip = getClientIp(req);
  const existing = rateLimitStore.get(ip);

  if (!existing || now - existing.start > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(ip, { start: now, count: 1 });
    return false;
  }

  existing.count += 1;
  rateLimitStore.set(ip, existing);
  return existing.count > RATE_LIMIT_MAX;
}

async function openaiRequest(pathname, options) {
  const url = `https://api.openai.com/v1${pathname}`;
  const headers = {
    Authorization: `Bearer ${OPENAI_API_KEY}`,
    "Content-Type": "application/json",
    "OpenAI-Beta": "assistants=v2",
    ...options.headers,
  };
  
  console.log(`🔵 OpenAI Request: ${options.method || 'GET'} ${pathname}`);
  
  const res = await fetchFn(url, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    console.error(`🔴 OpenAI Error ${res.status}:`, text);
    throw new Error(`OpenAI error ${res.status}: ${text}`);
  }
  return res.json();
}

// Manejar la ruta /api/assistant
async function handleAssistant(req, res) {
  console.log("\n📩 ===== NUEVA PETICIÓN AL ASISTENTE =====");
  
  try {
    if (isRateLimited(req)) {
      console.log("? Rate limit excedido");
      return sendJson(res, 429, { error: "Rate limit exceeded" });
    }
    const body = await readBody(req);
    console.log("📝 Body recibido:", body);
    
    const { message, thread_id } = JSON.parse(body);
    console.log("💬 Mensaje:", message);
    console.log("🧵 Thread ID:", thread_id || "nuevo thread");

    if (!message || typeof message !== "string") {
      console.log("❌ Mensaje inválido");
      return sendJson(res, 400, { error: "Missing or invalid 'message'" });
    }

    // 1. Crear o usar thread existente
    let threadId = thread_id;
    if (!threadId) {
      console.log("🆕 Creando nuevo thread...");
      const threadRes = await openaiRequest("/threads", {
        method: "POST",
        body: JSON.stringify({}),
      });
      threadId = threadRes.id;
      console.log("✅ Thread creado:", threadId);
    } else {
      console.log("♻️ Usando thread existente:", threadId);
    }

    // 2. Añadir mensaje del usuario al thread
    console.log("➕ Añadiendo mensaje al thread...");
    await openaiRequest(`/threads/${threadId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        role: "user",
        content: message,
      }),
    });
    console.log("✅ Mensaje añadido");

    // 3. Ejecutar el asistente
    console.log("🤖 Ejecutando asistente...");
    const runRes = await openaiRequest(`/threads/${threadId}/runs`, {
      method: "POST",
      body: JSON.stringify({
        assistant_id: ASSISTANT_ID,
      }),
    });
    const runId = runRes.id;
    console.log("✅ Run iniciado:", runId);

    // 4. Esperar a que termine la ejecución
    let runStatus = runRes.status;
    let attempts = 0;
    const maxAttempts = 60;

    console.log("⏳ Esperando respuesta del asistente...");
    while (
      runStatus !== "completed" &&
      runStatus !== "failed" &&
      runStatus !== "cancelled" &&
      runStatus !== "expired" &&
      attempts < maxAttempts
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const statusRes = await openaiRequest(`/threads/${threadId}/runs/${runId}`, {
        method: "GET",
      });
      runStatus = statusRes.status;
      attempts++;
      
      if (attempts % 5 === 0) {
        console.log(`⏱️ Status después de ${attempts}s: ${runStatus}`);
      }
    }

    console.log(`🏁 Run finalizado con status: ${runStatus}`);

    if (runStatus !== "completed") {
      console.error("❌ Run no completado");
      return sendJson(res, 500, {
        error: `Run failed with status: ${runStatus}`,
        thread_id: threadId,
      });
    }

    // 5. Obtener los mensajes del thread
    console.log("📬 Obteniendo mensajes...");
    const messagesRes = await openaiRequest(`/threads/${threadId}/messages`, {
      method: "GET",
    });

    // 6. Extraer la última respuesta del asistente
    const assistantMessages = messagesRes.data.filter((m) => m.role === "assistant");
    if (!assistantMessages.length) {
      console.error("❌ No se encontró respuesta del asistente");
      return sendJson(res, 500, {
        error: "No assistant response found",
        thread_id: threadId,
      });
    }

    const lastMessage = assistantMessages[0];
    const textContent = lastMessage.content.find((c) => c.type === "text");
    const reply = textContent ? textContent.text.value : "Sin respuesta";

    console.log("✅ Respuesta obtenida:", reply.substring(0, 100) + "...");
    console.log("===== FIN DE PETICIÓN =====\n");

    sendJson(res, 200, {
      reply,
      thread_id: threadId,
    });
  } catch (err) {
    console.error("🔴 ERROR en /api/assistant:", err.message);
    console.error(err.stack);
    sendJson(res, 500, { error: err.message });
  }
}

// Servir archivos estáticos
function serveStatic(req, res) {
  let filePath = req.url === "/" ? "/index.html" : req.url;
  
  const queryIndex = filePath.indexOf("?");
  if (queryIndex !== -1) {
    filePath = filePath.substring(0, queryIndex);
  }

  const safePath = path.normalize(filePath).replace(/^([/\\])+/, "");
  const rootDir = process.cwd();
  const resolvedPath = path.resolve(rootDir, safePath);

  if (!resolvedPath.startsWith(rootDir + path.sep)) {
    console.log(`? 400: ${req.url}`);
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("400 Bad Request");
    return;
  }

  const ext = path.extname(resolvedPath);
  const contentType = contentTypes[ext] || "application/octet-stream";

  fs.readFile(resolvedPath, (err, data) => {
    if (err) {
      if (err.code === "ENOENT") {
        console.log(`❌ 404: ${req.url}`);
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("404 Not Found");
      } else {
        console.error(`❌ 500: ${req.url}`, err);
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("500 Internal Server Error");
      }
      return;
    }

    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

// Crear servidor HTTP
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  console.log(`📍 ${req.method} ${pathname}`);

  // CORS headers
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Ruta API para el asistente
  if (pathname === "/api/assistant" && req.method === "POST") {
    return handleAssistant(req, res);
  }

  // Servir archivos estáticos
  if (req.method === "GET") {
    return serveStatic(req, res);
  }

  res.writeHead(405, { "Content-Type": "text/plain" });
  res.end("Method Not Allowed");
});

server.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
  console.log(`✅ Asistente ID: ${ASSISTANT_ID}`);
  console.log(`📊 Esperando peticiones...\n`);
});
