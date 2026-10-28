# 🎭 Quem Sou Eu? — Multiplayer Online em Tempo Real

Uma versão web multiplayer em tempo real do clássico jogo **"Quem Sou Eu?"** (*Heads Up* / *Palavra na Testa*), com dinâmica de salas privadas, turnos e chat de palpites com validação automática.

Construído com **Node.js**, **WebSockets (Socket.io)** e **Tailwind CSS**, 100% responsivo (**Mobile-First**), em **Português do Brasil (pt-BR)**.

---

## 🌟 Principais Funcionalidades

### 1. Conectividade e Salas em Tempo Real
- **Criação de Salas**: O jogador Host cria uma sala e o sistema gera automaticamente:
  - Um **Código de Sala** curto e legível (ex: `K9X2P`).
  - Um **Link Único de Convite** com botão de cópia com 1 clique.
  - Um **QR Code Dinâmico** gerado no backend (`/api/qr`), permitindo que amigos entrem instantaneamente pelo celular apenas apontando a câmera!
- **Fase Secreta de Sugestão de Palavras (Preparação)**:
  - Ao clicar em "Iniciar", o jogo entra primeiro na tela de **Sugestão de Palavras**.
  - Cada jogador digita uma palavra secreta e uma categoria para colocar na testa de um adversário.
  - O sistema mantém o que cada um escreveu sob sigilo total.
- **Sorteio com Desarranjo (Derangement) Matemático**:
  - **Regra de Ouro**: O backend executa um algoritmo de desarranjo cíclico que garante que **NENHUM jogador receba a própria palavra que ele mesmo escreveu**.
  - Cada participante recebe secretamente uma palavra sugerida por outro jogador da sala.
- **Sincronização Segura da "Palavra na Testa"**:
  - Todos os adversários conseguem ver a palavra na testa dos outros participantes.
  - O jogador da vez recebe apenas `???` em seu próprio dispositivo, tornando impossível trapacear inspecionando o tráfego de rede ou console.

### 2. Chat de Palpites com Validação Automática
- **Validação Inteligente**:
  - Quando o jogador da vez digita seu palpite no chat, o servidor processa e normaliza o texto (remoção de acentos, pontuação, caixa alta e prefixos como *"eu sou o..."*).
  - **Acerto**: Se o palpite for exato, o sistema registra o acerto automaticamente, toca som de vitória, computa a pontuação com bônus de agilidade de tempo (`100 + bônus`), anuncia em destaque dourado no chat global (*"🎉 Matheus acertou a palavra secreta: Pelé! (+160 pts)"*) e avança para o próximo turno após a celebração.
  - **Quase Lá!**: Se o palpite estiver a uma distância de edição mínima (Levenshtein $\le 2$), o jogador da vez recebe um alerta exclusivo: *"🔥 Você está muito perto!"*.
  - **Proteção Anti-Spoiler**: Se outro jogador digitar acidentalmente a palavra secreta da vez no chat, o sistema bloqueia e oculta a mensagem para o jogador da vez.
- **Botões de Resposta Rápida**:
  - Espectadores contam com botões rápidos com 1 toque (**👍 SIM**, **👎 NÃO**, **🤔 TALVEZ**) para responder rapidamente às perguntas do jogador da vez pelo celular ou PC.

### 3. Interface 100% Responsiva (Mobile-First & Desktop)
- **Celular (Smartphones)**: Layout vertical com botões grandes de toque fácil, cronômetro central de barra fluida, cartão de testa em destaque e caixa de chat sempre acessível.
- **Computador (Monitores)**: Layout amplo dividido em 3 colunas:
  - **Esquerda**: Placar e classificação ao vivo com avatares e pontuação.
  - **Centro**: Palco da rodada com o cartão de palavra na testa, cronômetro regressivo com alerta visual e botões de resposta rápida.
  - **Direita**: Chat global de palpites com histórico colorido e validação em tempo real.

### 4. Conteúdo 100% em Português (pt-BR)
- Banco de palavras estruturado em `data/palavras.json` com centenas de opções distribuídas em categorias populares:
  - 🌟 **Celebridades** (Silvio Santos, Pelé, Anitta, Neymar, Ayrton Senna, Faustão, Casimiro, etc.)
  - 🎬 **Personagens de Desenho** (Bob Esponja, Mickey Mouse, Pica-Pau, Goku, Homer Simpson, Shrek, etc.)
  - 🦁 **Animais** (Capivara, Ornitorrinco, Leão, Bicho-Preguiça, Tubarão, Camaleão, etc.)
  - 📦 **Objetos** (Liquidificador, Celular, Guarda-chuva, Torradeira, Micro-ondas, etc.)
  - 🚀 **Profissões** (Astronauta, Bombeiro, Detetive, Arqueólogo, Piloto de Avião, etc.)

---

## 🚀 Como Rodar Localmente

```bash
# 1. Instalar dependências
npm install

# 2. Iniciar servidor
npm start
```
Acesse `http://localhost:5173`.
