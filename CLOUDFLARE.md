# 🌐 Guia de Integração com a Cloudflare

Este guia explica como colocar o **"Quem Sou Eu?"** online com acesso global, HTTPS automático, proteção DDoS e suporte a WebSockets usando a infraestrutura da **Cloudflare**.

Como o jogo utiliza **WebSockets em tempo real (Socket.io)** e comunicação bidirecional de baixa latência, o método ideal e mais moderno é o **Cloudflare Tunnel (Zero Trust)**.

---

## 🚀 Método Recomendado: Cloudflare Tunnel (Zero Trust)

O Cloudflare Tunnel conecta seu servidor local diretamente à rede mundial da Cloudflare por meio de uma conexão segura de saída, **sem precisar abrir portas no roteador (sem NAT/port-forwarding)** e com **HTTPS gratuito**.

### Passo a Passo (Gratuito):

1. **Acesse o painel do Cloudflare Zero Trust**:
   - Vá para [https://one.dash.cloudflare.com/](https://one.dash.cloudflare.com/)
   - No menu lateral, acesse **Networks** > **Tunnels**.
   - Clique em **Create a Tunnel** (ou *Add a Tunnel*).
   - Escolha o conector **Cloudflared** e dê um nome (ex: `quem-sou-eu`).

2. **Copie o Token do Túnel**:
   - O painel exibirá um comando de instalação contendo um token longo no final:
     ```text
     eyJhIjoi... (este é o seu TUNNEL_TOKEN)
     ```
   - Guarde esse token.

3. **Configure o Domínio Público (Public Hostname)**:
   - Na aba **Public Hostname** do seu túnel:
     - **Subdomain**: `quemsoueu` (ou o nome que preferir)
     - **Domain**: Selecione seu domínio cadastrado na Cloudflare
     - **Service Type**: `HTTP`
     - **URL**: `localhost:5173` (ou `quem-sou-eu:5173` se estiver usando Docker)
   - Clique em **Save Tunnel**.

4. **Inicie o Túnel**:
   
   #### Opção A: Via Docker Compose (Mais Fácil)
   Crie um arquivo `.env` na raiz do projeto:
   ```env
   CLOUDFLARE_TUNNEL_TOKEN=seu_token_aqui
   ```
   E execute:
   ```bash
   docker compose --profile tunnel up -d
   ```

   #### Opção B: Via CLI `cloudflared` (Sem Docker)
   Se tiver o binário `cloudflared` instalado:
   ```bash
   cloudflared tunnel run --token seu_token_aqui
   ```

---

## ⚡ Verificação Essencial: Suporte a WebSockets no Cloudflare

Para que as salas e os palpites funcionem sem desconexões:

1. No painel principal da Cloudflare ([dash.cloudflare.com](https://dash.cloudflare.com)), selecione seu domínio.
2. No menu lateral, vá em **Network** (Rede).
3. Certifique-se de que a opção **WebSockets** está marcada como **ON** (Ativado).
   *(Por padrão, ela já vem ativada em todas as contas).*

---

## 📲 Benefícios Obtidos com a Cloudflare

- **Acesso Global**: Qualquer amigo em qualquer lugar do mundo pode entrar pelo link ou QR Code via HTTPS `https://quemsoueu.seudominio.com`.
- **Certificado SSL/TLS Automático**: Criptografia de ponta a ponta sem gerenciar certificados Let's Encrypt manualmente.
- **Proteção contra Ataques**: Camada de proteção DDoS e firewall inteligente contra bots maliciosos.
- **Zero Port Forwarding**: Não requer IP público estático nem configurações arriscadas no roteador de internet.
