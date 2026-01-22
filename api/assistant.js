// Usar fetch nativo de Node.js 18+ (Vercel usa Node.js 18+ por defecto)
// En Vercel, fetch está disponible globalmente en Node.js 18+
let fetchFn;
if (typeof globalThis.fetch !== 'undefined') {
  fetchFn = globalThis.fetch.bind(globalThis);
} else if (typeof global.fetch !== 'undefined') {
  fetchFn = global.fetch.bind(global);
} else {
  // Fallback a node-fetch si no está disponible (no debería ser necesario en Vercel)
  fetchFn = async (...args) => {
    const { default: fetch } = await import('node-fetch');
    return fetch(...args);
  };
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = process.env.ASSISTANT_ID;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "https://www.argentino.click,https://argentino.click,http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000;
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || 20;

const rateLimitStore = new Map();

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

async function parseBody(req) {
  // En Vercel, con el formato estándar (req, res), el body NO viene parseado automáticamente
  // Necesitamos leerlo del stream manualmente
  // Sin embargo, primero verificamos si req.body ya existe (por si acaso)
  
  // Verificar si req.body ya está parseado (algunas configuraciones pueden hacerlo)
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body) && !Array.isArray(req.body)) {
    console.log("Body already parsed by Vercel/config");
    return req.body;
  }
  
  // En Vercel, el body viene como stream - necesitamos leerlo
  // IMPORTANTE: No podemos leer el stream dos veces, así que intentamos solo una vez
  console.log("Reading body from stream...");
  try {
    const raw = await readBody(req);
    console.log("Raw body length:", raw ? raw.length : 0);
    
    if (!raw || raw.length === 0) {
      // Si no hay body, intentar usar req.body como último recurso
      if (req.body) {
        console.log("No raw body, using req.body as fallback");
        return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      }
      throw new Error("Empty body received");
    }
    
    // Parsear el JSON
    const parsed = JSON.parse(raw);
    console.log("Body successfully parsed from stream");
    return parsed;
  } catch (err) {
    console.error("Error parsing body from stream:", err.message);
    console.error("Error stack:", err.stack);
    
    // Si el error es de JSON parse, intentar req.body como último recurso
    if (err instanceof SyntaxError && req.body) {
      console.log("JSON parse error, trying req.body as fallback");
      try {
        if (typeof req.body === "string") {
          return JSON.parse(req.body);
        } else if (typeof req.body === "object") {
          return req.body;
        }
      } catch (fallbackErr) {
        console.error("Fallback also failed:", fallbackErr.message);
      }
    }
    
    throw new Error(`Error parsing body: ${err.message}`);
  }
}

function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.length > 0) {
    return forwardedFor.split(",")[0].trim();
  }
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "unknown";
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

  try {
    const response = await fetchFn(url, { ...options, headers });
    if (!response.ok) {
      const text = await response.text();
      console.error(`OpenAI API Error [${response.status}]:`, text);
      throw new Error(`OpenAI error ${response.status}: ${text}`);
    }
    return await response.json();
  } catch (err) {
    console.error(`Error in openaiRequest to ${pathname}:`, err.message);
    throw err;
  }
}

module.exports = async (req, res) => {
  console.log(`[${new Date().toISOString()}] Request received: ${req.method} ${req.url}`);
  console.log("Headers:", JSON.stringify(req.headers, null, 2));
  
  // Configurar CORS - permitir el origen que hace la petición
  const origin = req.headers.origin;
  if (origin) {
    // Si el origen está en la lista permitida o es localhost, permitirlo
    if (ALLOWED_ORIGINS.includes(origin) || origin.includes("localhost") || origin.includes("127.0.0.1") || origin.includes("vercel.app")) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    } else if (ALLOWED_ORIGINS.length > 0) {
      // Permitir el primer origen configurado como fallback
      res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGINS[0]);
    } else {
      // Si no hay orígenes configurados, permitir todos (solo para desarrollo)
      res.setHeader("Access-Control-Allow-Origin", "*");
    }
  } else {
    // Si no hay origin header, permitir todos (puede ser una petición directa)
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    console.log("OPTIONS request - returning 204");
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST") {
    console.log(`Method ${req.method} not allowed`);
    res.writeHead(405, { "Content-Type": "text/plain" });
    res.end("Method Not Allowed");
    return;
  }

  if (!OPENAI_API_KEY || !ASSISTANT_ID) {
    console.error("Error: Missing environment variables", {
      hasKey: !!OPENAI_API_KEY,
      hasAssistantId: !!ASSISTANT_ID
    });
    sendJson(res, 500, { error: "Server misconfigured: Missing API key or Assistant ID. Please configure environment variables in Vercel." });
    return;
  }

  if (isRateLimited(req)) {
    sendJson(res, 429, { error: "Rate limit exceeded" });
    return;
  }

  try {
    console.log("Attempting to parse request body...");
    console.log("req.body exists:", !!req.body);
    console.log("req.body type:", typeof req.body);
    console.log("Content-Type:", req.headers["content-type"]);
    
    // Parsear el body - en Vercel puede venir parseado o como stream
    let body;
    try {
      body = await parseBody(req);
      console.log("Body parsed successfully:", JSON.stringify(body, null, 2));
    } catch (parseErr) {
      console.error("Error parsing request body:", parseErr);
      console.error("Parse error stack:", parseErr.stack);
      sendJson(res, 400, { 
        error: "Invalid JSON in request body",
        details: parseErr.message 
      });
      return;
    }

    if (!body || typeof body !== "object") {
      console.error("Body is not an object:", body);
      sendJson(res, 400, { error: "Request body must be a JSON object" });
      return;
    }

    const { message, thread_id } = body;
    console.log("Extracted message:", message);
    console.log("Extracted thread_id:", thread_id);
    
    if (!message || typeof message !== "string") {
      console.error("Invalid message:", message);
      sendJson(res, 400, { error: "Missing or invalid 'message' field" });
      return;
    }

    let threadId = thread_id;
    if (!threadId) {
      const threadRes = await openaiRequest("/threads", {
        method: "POST",
        body: JSON.stringify({}),
      });
      threadId = threadRes.id;
    }

    await openaiRequest(`/threads/${threadId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        role: "user",
        content: message,
      }),
    });

    const runRes = await openaiRequest(`/threads/${threadId}/runs`, {
      method: "POST",
      body: JSON.stringify({
        assistant_id: ASSISTANT_ID,
      }),
    });
    const runId = runRes.id;

    let runStatus = runRes.status;
    let attempts = 0;
    // IMPORTANTE: Vercel tiene límites de timeout estrictos:
    // Plan gratuito (Hobby): 10 segundos máximo
    // Plan Pro: 60 segundos máximo
    // Reducir significativamente para evitar timeouts
    const maxAttempts = 8; // Reducir a 8 intentos (8 segundos) para el plan gratuito
    const startTime = Date.now();
    const maxWaitTime = 8000; // 8 segundos máximo para evitar timeouts en plan gratuito

    console.log(`Starting run ${runId} with status: ${runStatus}`);

    while (
      runStatus !== "completed" &&
      runStatus !== "failed" &&
      runStatus !== "cancelled" &&
      runStatus !== "expired" &&
      runStatus !== "requires_action" &&
      attempts < maxAttempts &&
      (Date.now() - startTime) < maxWaitTime
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const statusRes = await openaiRequest(`/threads/${threadId}/runs/${runId}`, {
        method: "GET",
      });
      runStatus = statusRes.status;
      attempts += 1;
      
      console.log(`Run ${runId} status after ${attempts}s: ${runStatus}`);
    }
    
    console.log(`Final run status: ${runStatus} (after ${attempts} attempts)`);

    // Si el run está aún en progreso o requiere acción, devolver información útil
    if (runStatus === "requires_action") {
      sendJson(res, 500, {
        error: "El asistente requiere acción del usuario. Esto no está soportado actualmente.",
        thread_id: threadId,
        run_status: runStatus,
      });
      return;
    }
    
    if (runStatus !== "completed") {
      // Si el run está en progreso (queued, in_progress), informar al usuario
      if (runStatus === "queued" || runStatus === "in_progress") {
        sendJson(res, 500, {
          error: `El asistente está procesando tu mensaje pero tardó más de lo esperado. Por favor, intenta nuevamente en unos segundos. Status: ${runStatus}`,
          thread_id: threadId,
          run_status: runStatus,
          suggestion: "Intenta enviar el mensaje nuevamente usando el mismo thread_id para continuar la conversación.",
        });
        return;
      }
      
      sendJson(res, 500, {
        error: `El run no se completó. Status: ${runStatus}`,
        thread_id: threadId,
        run_status: runStatus,
      });
      return;
    }

    const messagesRes = await openaiRequest(`/threads/${threadId}/messages`, {
      method: "GET",
    });

    const assistantMessages = messagesRes.data.filter((m) => m.role === "assistant");
    if (!assistantMessages.length) {
      sendJson(res, 500, {
        error: "No assistant response found",
        thread_id: threadId,
      });
      return;
    }

    const lastMessage = assistantMessages[0];
    const textContent = lastMessage.content.find((c) => c.type === "text");
    const reply = textContent ? textContent.text.value : "Sin respuesta";

    sendJson(res, 200, {
      reply,
      thread_id: threadId,
    });
  } catch (err) {
    console.error("Error in assistant handler:", err);
    sendJson(res, 500, { 
      error: err.message || "Internal server error",
      details: process.env.NODE_ENV === "development" ? err.stack : undefined
    });
  }
};
