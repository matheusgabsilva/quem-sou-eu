# 🌐 Hospedagem em Produção e Integração Cloudflare

Este documento descreve a arquitetura de produção do jogo **Quem Sou?**, hospedado no **Render** e servido sob o domínio oficial `https://quemsou.online` através do **DNS e Proxy da Cloudflare**.

---

## 🏗️ Arquitetura de Produção

```
[ Usuários / Celular / PC ]
           │
           ▼ (HTTPS / WSS)
┌──────────────────────────────────────────────┐
│  Cloudflare (DNS & Proxy Laranja Ativo)      │
│  - Domínio: https://quemsou.online           │
│  - Certificado SSL/TLS Automático (Edge)     │
│  - Proteção DDoS & Firewall                  │
│  - Suporte a WebSockets Ativado              │
└──────────────────────┬───────────────────────┘
                       │ (Proxy reverso HTTPS/WSS)
                       ▼
┌──────────────────────────────────────────────┐
│  Render (Web Service Node.js)                │
│  - Executa: node server.js                   │
│  - Porta: $PORT (padrão 5173 / dinâmico)     │
│  - Socket.io (HTTP polling + WebSocket)      │
└──────────────────────────────────────────────┘
```

> [!IMPORTANT]
> **A produção NÃO utiliza Cloudflare Tunnel (cloudflared).**
> O serviço web roda diretamente no Render, e a Cloudflare atua como **DNS autoritativo com Proxy reverso (nuvem laranja)** à frente do Render.

---

## ⚙️ Configurações de Produção

### 1. No Painel da Cloudflare (dash.cloudflare.com)

1. **DNS Records (Registros DNS)**:
   - Tipo `CNAME`: apontando `@` (ou subdomínio desejado) para o hostname do serviço no Render (ex: `quem-sou-eu-xxxx.onrender.com`).
   - **Proxy Status**: **Proxied (Nuvem Laranja Ativada)** para garantir SSL, proteção DDoS e aceleração.
2. **SSL/TLS**:
   - Modo de criptografia: **Full** ou **Full (Strict)**, já que o Render fornece terminação TLS com certificado próprio no backend.
3. **WebSockets (Essencial para o jogo)**:
   - Em **Network (Rede)**: Certifique-se de que a opção **WebSockets** está marcada como **ON** (Ativado).

### 2. No Painel do Render (dashboard.render.com)

1. **Tipo de Serviço**: Web Service (Node.js).
2. **Build Command**: `npm ci`
3. **Start Command**: `npm start`
4. **Environment Variables**:
   - `NODE_ENV=production`
   - `PORT`: gerenciada automaticamente pelo Render (o servidor consome `process.env.PORT`).
5. **Custom Domains**:
   - Configurado para `quemsou.online` e/ou `www.quemsou.online`.

---

## 🔍 O que está confirmado no código vs. O que depende do painel

| Componente | Confirmado no Código da Aplicação | Depende de Painel Externo / Teste Manual |
|:---|:---|:---|
| **Porta e Binding** | `server.listen(port, "0.0.0.0")` em `server.js`, aceitando `process.env.PORT`. | Configuração da porta injetada pelo ambiente Render. |
| **CORS do Socket.io** | Configurado como `origin: "*"` em `server.js`, permitindo conexões através do proxy. | Preservação dos headers de upgrade WebSocket pelo proxy Cloudflare. |
| **Domínio Canônico** | `https://quemsou.online` definido em `public/js/ui-render.js`, `index.html` e `manifest.json`. | Apontamento CNAME e propagação de DNS no Cloudflare. |
| **Links e QR Code** | Roteamento dinâmico: IP privado preserva origem local; produção gera `https://quemsou.online/?room=...`. | Resolução pública do domínio e terminação SSL do Cloudflare. |
| **Health Check** | Endpoints `/api/info` e `/api/qr` respondendo em `server.js`. | Health check configurado no painel do Render (se habilitado). |

---

## 🛠️ Ambiente Local (Desenvolvimento)

Em ambiente local de desenvolvimento, você pode:
- Executar localmente com `npm start` em `http://localhost:5173`.
- Conectar outros dispositivos na mesma rede Wi-Fi via IP local (`http://192.168.x.x:5173` ou `http://10.x.x.x:5173` ou `http://172.16-31.x.x:5173`).
- Caso deseje testar túneis temporários em ambiente de desenvolvimento isolado, o `docker-compose.yml` inclui um perfil opcional `--profile tunnel` via container `cloudflared`, mas ele **não** é utilizado nem necessário na infraestrutura de produção.
