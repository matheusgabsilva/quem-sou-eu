import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import QRCode from "qrcode";
import { sendJson, localAddresses } from "./lib/server-utils.js";
import { getAvailableCategories } from "./lib/words.js";
import { setupSocketHandlers } from "./lib/socket-handler.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT || 5173);

// Tabela de tipos MIME para arquivos estáticos
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav"
};

// Servidor de arquivos estáticos com suporte a SPA fallback
async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);

  // Favicon fallback transparente para o novo logo SVG
  if (requested === "/favicon.ico" || requested === "/favicon.svg") {
    try {
      const data = await readFile(join(publicDir, "images", "logo.svg"));
      res.writeHead(200, {
        "content-type": "image/svg+xml",
        "cache-control": "public, max-age=86400"
      });
      res.end(data);
      return;
    } catch {}
  }

  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);

  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(data);
  } catch {
    // Retorna index.html para qualquer rota não mapeada
    try {
      const data = await readFile(join(publicDir, "index.html"));
      res.writeHead(200, {
        "content-type": mimeTypes[".html"],
        "cache-control": "no-store"
      });
      res.end(data);
    } catch (err) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Página inicial não encontrada.");
    }
  }
}

// Servidor HTTP base
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    // Rota GET /api/qr — Gera QR Code SVG em tempo real
    if (req.method === "GET" && url.pathname === "/api/qr") {
      const data = (url.searchParams.get("data") || "").trim();
      if (!data) {
        sendJson(res, 400, { error: "Parâmetro 'data' é obrigatório." });
        return;
      }

      const svg = await QRCode.toString(data, {
        type: "svg",
        margin: 1,
        width: 260,
        color: { dark: "#1e1e24", light: "#ffffff" }
      });

      res.writeHead(200, {
        "content-type": "image/svg+xml",
        "cache-control": "no-store",
        "access-control-allow-origin": "*"
      });
      res.end(svg);
      return;
    }

    // Rota GET /api/info — Informações de rede e categorias disponíveis
    if (req.method === "GET" && url.pathname === "/api/info") {
      const ips = localAddresses();
      const categories = await getAvailableCategories();
      sendJson(res, 200, {
        port,
        localIps: ips,
        mobileUrls: ips.map((ip) => `http://${ip}:${port}`),
        categories
      });
      return;
    }

    // Rota GET /api/categories — Apenas categorias
    if (req.method === "GET" && url.pathname === "/api/categories") {
      const categories = await getAvailableCategories();
      sendJson(res, 200, { categories });
      return;
    }

    // Servir arquivos do frontend
    await serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Erro interno do servidor" });
  }
});

// Configuração do Socket.io
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

setupSocketHandlers(io);

server.listen(port, "0.0.0.0", () => {
  console.log(`\n======================================================`);
  console.log(`  🎉 QUEM SOU? - Multiplayer em Tempo Real`);
  console.log(`======================================================`);
  console.log(`💻 Acesso Local (PC): http://localhost:${port}`);
  const ips = localAddresses();
  for (const ip of ips) {
    console.log(`📱 Acesso no Celular (Mesmo Wi-Fi): http://${ip}:${port}`);
  }
  console.log(`======================================================\n`);
});
