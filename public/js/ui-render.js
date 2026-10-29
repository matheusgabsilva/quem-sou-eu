import { state, saveLocalPlayer, toggleSound, safeStorage, getScreenForRoomState } from "./state.js";
import { sound } from "./audio.js";
import {
  escapeHtml,
  sendChatMessage,
  sendPlayerGuess,
  sendQuickReaction,
  renderMessageElement,
  shouldFollowChatScroll,
  calculateRestoredScrollPosition
} from "./chat.js";

export const OFFICIAL_DOMAIN = "https://quemsou.online";

// Identifica se um hostname pertence a loopback ou à rede privada local
export function isPrivateOrLocalHost(hostname) {
  if (!hostname) return false;
  const host = String(hostname).trim().toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") {
    return true;
  }

  // Validação estrita de endereços IPv4
  const ipv4Parts = host.split(".");
  if (ipv4Parts.length === 4 && ipv4Parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255)) {
    const [o1, o2] = ipv4Parts.map(Number);
    // 127.0.0.0/8
    if (o1 === 127) return true;
    // 10.0.0.0/8
    if (o1 === 10) return true;
    // 192.168.0.0/16
    if (o1 === 192 && o2 === 168) return true;
    // 172.16.0.0/12 (172.16.0.0 a 172.31.255.255)
    if (o1 === 172 && o2 >= 16 && o2 <= 31) return true;
    return false;
  }

  return false;
}

// Gera o link de compartilhamento preservando origens locais em desenvolvimento
export function getShareUrl(roomCode) {
  const code = encodeURIComponent((roomCode || "").toUpperCase());
  if (typeof window !== "undefined" && window.location) {
    const hostname = window.location.hostname || "";
    if (isPrivateOrLocalHost(hostname)) {
      return `${window.location.origin}/?room=${code}`;
    }
  }
  return `${OFFICIAL_DOMAIN}/?room=${code}`;
}

// Proporção de colunas no layout desktop do tabuleiro (3/12 Placar, 4/12 Palco Central, 5/12 Chat)
export const BOARD_LAYOUT_SPANS = {
  scoreboard: 3,
  centerStage: 4,
  chat: 5
};

// 9 Regras oficiais do jogo exibidas no tutorial acessível
export const TUTORIAL_RULES = [
  "Cada participante recebe uma palavra secreta na testa que os demais conseguem ver, mas a própria pessoa não vê a sua palavra.",
  "Na sua vez de jogar, a pessoa faz exatamente uma pergunta no chat para receber pistas dos outros jogadores.",
  "Depois da primeira resposta válida, o jogador da vez pode escolher entre dar um palpite ou passar a vez.",
  "É permitido apenas um único palpite por tentativa. Passar a vez também encerra a tentativa imediatamente.",
  "As outras pessoas ainda podem responder enquanto o turno estiver aberto, inclusive depois que a primeira resposta liberou o palpite.",
  "Se a pessoa errar o palpite, passar a vez ou o tempo acabar, ela volta ao fim da fila e mantém a mesma palavra secreta para tentar novamente.",
  "Quem acertar sai da fila de palpites daquela rodada, mas continua podendo responder às perguntas dos outros.",
  "A rodada só termina quando todos os participantes elegíveis acertarem ou saírem da fila por desconexão.",
  "A pontuação do acerto combina a base da tentativa global da rodada com o bônus calculado pelo tempo restante (a base diminui a cada tentativa da rodada e o tempo restante afeta o bônus)."
];

let tutorialKeydownHandler = null;
let tutorialOpenerElement = null;

// Elementos focáveis do modal, na ordem do DOM (usados na contenção de foco com Tab / Shift+Tab)
export const TUTORIAL_FOCUSABLE_IDS = ["btn-close-tutorial", "tutorial-modal-content", "btn-confirm-tutorial"];
const TUTORIAL_CONTAINER_ID = "tutorial-modal-container";

// Decide para qual elemento o foco deve ser movido para manter a navegação por teclado dentro do modal.
// Retorna o id do destino ou null quando o comportamento natural do navegador já fica dentro do modal.
export function getTutorialFocusTarget(activeId, shiftKey) {
  const ids = TUTORIAL_FOCUSABLE_IDS;
  const index = ids.indexOf(activeId);
  if (shiftKey) {
    // Shift+Tab no primeiro item (ou no próprio diálogo / fora dele) volta para o último
    return index <= 0 ? ids[ids.length - 1] : null;
  }
  // Tab no último item (ou com o foco fora do modal) volta para o primeiro
  if (index === ids.length - 1) return ids[0];
  if (index === -1 && activeId !== TUTORIAL_CONTAINER_ID) return ids[0];
  return null;
}

// Abre modal acessível de tutorial com as regras do jogo
export function openTutorialModal(openerElement = null) {
  if (typeof document === "undefined") return null;
  if (document.getElementById("tutorial-modal-backdrop")) {
    return document.getElementById("tutorial-modal-backdrop");
  }

  // Guarda o elemento que abriu o modal para devolver o foco ao fechar
  // (Safari/Firefox no macOS não focam botões ao clicar, por isso o chamador informa o botão explicitamente)
  tutorialOpenerElement = openerElement || document.activeElement || null;

  const backdrop = document.createElement("div");
  backdrop.id = "tutorial-modal-backdrop";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");
  backdrop.setAttribute("aria-labelledby", "tutorial-modal-title");
  backdrop.className = "fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-3 md:p-4 overscroll-contain animate-fade-in";

  backdrop.innerHTML = `
    <div
      id="tutorial-modal-container"
      class="glass-panel w-full max-w-lg max-h-[88vh] md:max-h-[82vh] flex flex-col rounded-3xl shadow-2xl border border-cyan-500/30 overflow-hidden relative focus:outline-none"
      tabindex="-1"
    >
      <!-- Cabeçalho do Modal -->
      <div class="flex items-center justify-between p-4 md:p-5 border-b border-slate-700/60 bg-slate-900/60 flex-shrink-0">
        <div class="flex items-center gap-2.5">
          <span class="w-8 h-8 rounded-xl bg-cyan-500/20 text-cyan-300 font-black text-lg flex items-center justify-center border border-cyan-500/40">?</span>
          <div>
            <h2 id="tutorial-modal-title" class="text-base md:text-lg font-black text-white m-0">Como Jogar Quem Sou?</h2>
            <p class="text-[11px] text-slate-400 m-0">Guia rápido de regras e dinâmica da partida</p>
          </div>
        </div>
        <button
          id="btn-close-tutorial"
          type="button"
          aria-label="Fechar tutorial"
          class="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-black text-sm flex items-center justify-center border border-slate-700 transition focus:outline-none focus:ring-2 focus:ring-cyan-400 cursor-pointer"
        >
          ✕
        </button>
      </div>

      <!-- Conteúdo com Rolagem Interna -->
      <div id="tutorial-modal-content" tabindex="0" aria-label="Lista de regras do jogo" class="p-4 md:p-5 overflow-y-auto space-y-2.5 scrollbar-thin text-slate-200 flex-1 min-h-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-inset">
        <ol class="space-y-2.5 text-xs md:text-sm list-none p-0 m-0">
          ${TUTORIAL_RULES.map((rule, index) => `
            <li class="flex items-start gap-2.5 p-2.5 rounded-2xl bg-slate-800/60 border border-slate-700/60">
              <span class="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-300 font-bold text-xs flex items-center justify-center border border-cyan-500/30 mt-0.5">
                ${index + 1}
              </span>
              <p class="m-0 leading-relaxed text-slate-300 flex-1">${escapeHtml(rule)}</p>
            </li>
          `).join("")}
        </ol>
      </div>

      <!-- Rodapé do Modal -->
      <div class="p-3 md:p-4 border-t border-slate-700/60 bg-slate-900/60 flex justify-end flex-shrink-0">
        <button
          id="btn-confirm-tutorial"
          type="button"
          class="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-black text-xs md:text-sm shadow-lg shadow-cyan-500/20 active:scale-98 transition focus:outline-none focus:ring-2 focus:ring-cyan-300 cursor-pointer"
        >
          Entendi, vamos jogar!
        </button>
      </div>
    </div>
  `;

  // Fechar ao clicar fora (backdrop)
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      closeTutorialModal();
    }
  });

  document.body.appendChild(backdrop);

  // Botões de fechar
  document.getElementById("btn-close-tutorial")?.addEventListener("click", closeTutorialModal);
  document.getElementById("btn-confirm-tutorial")?.addEventListener("click", closeTutorialModal);

  // Fechar por Escape e conter o foco dentro do modal (Tab / Shift+Tab)
  tutorialKeydownHandler = (e) => {
    if (e.key === "Escape") {
      closeTutorialModal();
      return;
    }
    if (e.key === "Tab") {
      const activeId = document.activeElement?.id || "";
      const targetId = getTutorialFocusTarget(activeId, !!e.shiftKey);
      if (targetId) {
        if (typeof e.preventDefault === "function") e.preventDefault();
        document.getElementById(targetId)?.focus();
      }
    }
  };
  window.addEventListener("keydown", tutorialKeydownHandler);

  // Foco inicial no próprio diálogo: o leitor de tela anuncia o título e a lista começa visível no topo
  document.getElementById(TUTORIAL_CONTAINER_ID)?.focus();

  return backdrop;
}

// Fecha o modal de tutorial, remove listeners e devolve o foco ao botão que o abriu
export function closeTutorialModal() {
  if (typeof document === "undefined") return;
  const backdrop = document.getElementById("tutorial-modal-backdrop");
  if (backdrop && backdrop.parentNode) {
    backdrop.parentNode.removeChild(backdrop);
  }
  if (tutorialKeydownHandler && typeof window !== "undefined") {
    window.removeEventListener("keydown", tutorialKeydownHandler);
    tutorialKeydownHandler = null;
  }

  // Se a tela foi redesenhada com o modal aberto, o botão original deixou de existir no DOM:
  // nesse caso o foco vai para o botão "?" da tela atual.
  const opener = tutorialOpenerElement;
  tutorialOpenerElement = null;
  const target = opener && opener !== document.body && opener.isConnected !== false
    ? opener
    : document.getElementById("btn-open-tutorial");
  if (target && typeof target.focus === "function") target.focus();
}


const AVATAR_LIST = ["🦊", "🦁", "🐼", "🐸", "🦄", "🚀", "🎭", "🎩", "👑", "🍕", "🥑", "🎸", "🐱", "🐶", "🐵", "🐯"];

export function renderCurrentScreen() {
  const app = document.getElementById("app");
  if (!app) return;

  switch (state.currentScreen) {
    case "home":
      renderHome(app);
      break;
    case "lobby":
      renderLobby(app);
      break;
    case "word_suggestion":
      renderWordSuggestion(app);
      break;
    case "game":
      renderGame(app);
      break;
    case "podium":
      renderPodium(app);
      break;
    default:
      renderHome(app);
  }
}

// ==========================================
// 1. TELA INICIAL (HOME)
// ==========================================
function renderHome(container) {
  const urlParams = new URLSearchParams(window.location.search);
  const roomQuery = (urlParams.get("room") || "").toUpperCase();

  // Garante que o avatar inicial seja válido
  if (!state.playerAvatar || !AVATAR_LIST.includes(state.playerAvatar)) {
    state.playerAvatar = "🦊";
  }

  container.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="glass-panel w-full max-w-md p-6 md:p-8 rounded-3xl shadow-2xl relative overflow-hidden">
        <!-- Detalhes decorativos no topo e fundo -->
        <div class="absolute -top-12 -left-12 w-32 h-32 bg-cyan-500/20 rounded-full blur-2xl"></div>
        <div class="absolute -bottom-12 -right-12 w-32 h-32 bg-pink-500/20 rounded-full blur-2xl"></div>

        <!-- Botão Tutorial / Ajuda no canto superior direito -->
        <button
          id="btn-open-tutorial"
          type="button"
          aria-label="Como jogar / Tutorial de Regras"
          aria-haspopup="dialog"
          title="Como jogar?"
          class="absolute top-4 right-4 w-9 h-9 rounded-full bg-slate-800/90 hover:bg-slate-700 text-cyan-300 border border-slate-700/80 font-black text-sm flex items-center justify-center shadow-md hover:scale-105 active:scale-95 transition z-20 cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan-400"
        >
          ?
        </button>

        <!-- Cabeçalho / Logo -->
        <div class="text-center mb-6">
          <img src="/images/logo.svg" alt="Logo Quem Sou?" class="w-24 h-24 mx-auto mb-3 drop-shadow-2xl animate-pulse-subtle" />
          <h1 class="text-3xl md:text-4xl font-black tracking-tight text-white m-0">QUEM SOU?</h1>
          <p class="text-slate-400 text-xs md:text-sm font-medium mt-1">O clássico jogo da palavra na testa em tempo real</p>
        </div>

        <!-- Formulário de Jogador -->
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">Seu Nome / Apelido</label>
            <input
              type="text"
              id="player-name-input"
              maxlength="16"
              placeholder="Digite seu nome..."
              value="${escapeHtml(state.playerName)}"
              class="glass-input w-full px-4 py-3 rounded-2xl text-white font-bold text-base focus:ring-2 focus:ring-cyan-400 transition"
            />
          </div>

          <!-- Seleção de Avatar com preservação confiável -->
          <div>
            <label class="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">Escolha seu Avatar</label>
            <div class="flex gap-2 overflow-x-auto pb-2 scrollbar-none py-1" id="avatar-selector">
              ${AVATAR_LIST.map(
                (avatar) => `
                <button
                  type="button"
                  data-avatar="${avatar}"
                  class="avatar-option flex-none w-11 h-11 text-2xl rounded-2xl flex items-center justify-center transition ${
                    state.playerAvatar === avatar
                      ? "bg-cyan-500 ring-2 ring-cyan-300 scale-110 shadow-lg shadow-cyan-500/30"
                      : "bg-slate-800/80 hover:bg-slate-700"
                  }"
                >
                  ${avatar}
                </button>
              `
              ).join("")}
            </div>
          </div>

          <!-- Ações principais -->
          <div class="pt-2 space-y-3">
            <button
              id="btn-create-room"
              class="w-full py-3.5 px-6 rounded-2xl font-black text-slate-900 bg-gradient-to-r from-cyan-400 to-teal-400 hover:from-cyan-300 hover:to-teal-300 shadow-lg shadow-cyan-500/25 active:scale-98 transition flex items-center justify-center gap-2 text-base"
            >
              <span>👑</span> Criar Nova Sala
            </button>

            <div class="relative flex py-2 items-center">
              <div class="flex-grow border-t border-slate-700"></div>
              <span class="flex-shrink mx-4 text-xs font-bold uppercase text-slate-500">ou entre com código</span>
              <div class="flex-grow border-t border-slate-700"></div>
            </div>

            <div class="flex gap-2">
              <input
                type="text"
                id="room-code-input"
                maxlength="5"
                placeholder="CÓDIGO (ex: K9X2P)"
                value="${escapeHtml(roomQuery)}"
                class="glass-input uppercase text-center tracking-widest font-black text-lg w-2/3 px-3 py-3 rounded-2xl text-white"
              />
              <button
                id="btn-join-room"
                class="w-1/3 py-3 px-4 rounded-2xl font-black text-white bg-slate-800 hover:bg-slate-700 border border-slate-600 active:scale-98 transition text-sm flex items-center justify-center gap-1"
              >
                Entrar 🚀
              </button>
            </div>
          </div>
        </div>

        <!-- Rodapé do Card -->
        <div class="mt-6 pt-4 border-t border-slate-800/60 flex items-center justify-between text-xs text-slate-400">
          <span class="flex items-center gap-1">🎮 Multiplayer em Tempo Real</span>
          <button id="btn-toggle-sound" class="hover:text-white transition">
            ${state.soundEnabled ? "🔊 Som Ativado" : "🔇 Mudo"}
          </button>
        </div>
      </div>
    </div>
  `;

  bindHomeEvents();
}

function bindHomeEvents() {
  // Seleção de Avatar
  document.querySelectorAll(".avatar-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".avatar-option").forEach((el) => {
        el.className = "avatar-option flex-none w-11 h-11 text-2xl rounded-2xl flex items-center justify-center transition bg-slate-800/80 hover:bg-slate-700";
      });
      btn.className = "avatar-option flex-none w-11 h-11 text-2xl rounded-2xl flex items-center justify-center transition bg-cyan-500 ring-2 ring-cyan-300 scale-110 shadow-lg shadow-cyan-500/30";
      state.playerAvatar = btn.dataset.avatar;
      safeStorage.setItem("qse_avatar", state.playerAvatar);
    });
  });

  // Criar Sala (envia nome e avatar selecionado)
  document.getElementById("btn-create-room")?.addEventListener("click", () => {
    const nameInput = document.getElementById("player-name-input");
    const name = nameInput.value.trim() || "Host";
    saveLocalPlayer(name, state.playerAvatar);

    sound.ensureContext();
    state.socket.emit("create_room", { name, avatar: state.playerAvatar, settings: {} }, (res) => {
      if (res && res.success) {
        state.roomCode = res.code;
        state.room = res.room;
        state.currentScreen = "lobby";
        renderCurrentScreen();
      } else {
        showToast(res?.error || "Erro ao criar sala.", "error");
      }
    });
  });

  // Entrar na Sala (envia nome e avatar selecionado)
  document.getElementById("btn-join-room")?.addEventListener("click", () => {
    const nameInput = document.getElementById("player-name-input");
    const codeInput = document.getElementById("room-code-input");
    const name = nameInput.value.trim() || "Jogador";
    const code = codeInput.value.trim().toUpperCase();

    if (!code) {
      showToast("Por favor, digite o código da sala.", "warning");
      return;
    }

    saveLocalPlayer(name, state.playerAvatar);
    sound.ensureContext();

    state.socket.emit("join_room", { code, name, avatar: state.playerAvatar }, (res) => {
      if (res && res.success) {
        state.roomCode = res.code;
        state.room = res.room;
        state.currentScreen = getScreenForRoomState(res.room?.state);
        renderCurrentScreen();
      } else {
        showToast(res?.error || "Erro ao entrar na sala.", "error");
      }
    });
  });

  // Alternar Som
  document.getElementById("btn-toggle-sound")?.addEventListener("click", () => {
    toggleSound();
    renderCurrentScreen();
  });

  // Abrir Tutorial de Regras
  const btnOpenTutorial = document.getElementById("btn-open-tutorial");
  btnOpenTutorial?.addEventListener("click", () => {
    openTutorialModal(btnOpenTutorial);
  });
}

// ==========================================
// 2. TELA DE LOBBY (SALA DE ESPERA)
// ==========================================
function renderLobby(container) {
  const room = state.room;
  if (!room) return;

  const isHost = room.hostId === state.myId;
  const joinUrl = getShareUrl(room.code);
  const qrUrl = `/api/qr?data=${encodeURIComponent(joinUrl)}`;

  const selectedCategories = room.settings?.categories || ["celebridades", "desenhos", "animais", "objetos", "profissoes"];
  const turnTime = room.settings?.turnTime || 60;
  const totalRounds = room.settings?.totalRounds || 3;

  container.innerHTML = `
    <div class="min-h-screen p-4 max-w-5xl mx-auto flex flex-col justify-center">
      <!-- Barra superior do Lobby -->
      <div class="flex items-center justify-between mb-4">
        <button id="btn-leave-lobby" class="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-bold transition">
          ← Sair da Sala
        </button>
        <div class="flex items-center gap-2">
          <span class="text-xs font-bold text-slate-400">Código da Sala:</span>
          <span class="px-3 py-1 rounded-lg bg-cyan-500/20 text-cyan-300 font-black text-lg tracking-widest border border-cyan-500/40">${room.code}</span>
          <button
            id="btn-open-tutorial"
            type="button"
            aria-label="Como jogar / Tutorial de Regras"
          aria-haspopup="dialog"
            title="Como jogar?"
            class="w-8 h-8 rounded-full bg-slate-800/90 hover:bg-slate-700 text-cyan-300 border border-slate-700/80 font-black text-sm flex items-center justify-center shadow-md hover:scale-105 active:scale-95 transition cursor-pointer ml-1 focus:outline-none focus:ring-2 focus:ring-cyan-400"
          >
            ?
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-12 gap-5">
        <!-- Coluna 1: Convite & QR Code -->
        <div class="md:col-span-4 glass-panel p-5 rounded-3xl flex flex-col items-center text-center">
          <h2 class="text-lg font-black text-white m-0">Convide seus Amigos</h2>
          <p class="text-xs text-slate-400 mt-1 mb-4">Escaneie o QR Code no celular para entrar na hora!</p>

          <div class="bg-white p-3 rounded-2xl shadow-xl mb-4 border border-slate-200">
            <img src="${qrUrl}" alt="QR Code da Sala" class="w-48 h-48 object-contain" />
          </div>

          <button
            id="btn-copy-link"
            class="w-full py-2.5 px-4 rounded-xl font-bold text-sm bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 flex items-center justify-center gap-2 active:scale-98 transition"
          >
            📋 Copiar Link da Sala
          </button>
        </div>

        <!-- Coluna 2: Lista de Jogadores & Configurações da Partida -->
        <div class="md:col-span-8 flex flex-col gap-4">
          <!-- Jogadores Conectados -->
          <div class="glass-panel p-5 rounded-3xl flex-1">
            <div class="flex items-center justify-between mb-3">
              <h3 class="text-base font-black text-white m-0 flex items-center gap-2">
                <span>👥</span> Jogadores Conectados (${room.players.length})
              </h3>
              ${isHost ? '<span class="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">Você é o Host 👑</span>' : '<span class="text-xs text-slate-400">Aguardando o Host iniciar...</span>'}
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              ${room.players.map((p) => `
                <div class="flex items-center gap-2.5 p-2.5 rounded-2xl bg-slate-800/70 border ${p.id === state.myId ? 'border-cyan-500/50 bg-cyan-950/20' : 'border-slate-700/60'}">
                  <span class="text-2xl">${escapeHtml(p.avatar)}</span>
                  <div class="overflow-hidden">
                    <p class="text-sm font-bold text-white truncate m-0 flex items-center gap-1">
                      ${escapeHtml(p.name)}
                      ${p.id === room.hostId ? '👑' : ''}
                    </p>
                    <span class="text-[10px] text-slate-400">${p.id === state.myId ? '(Você)' : 'Pronto'}</span>
                  </div>
                </div>
              `).join("")}
            </div>
          </div>

          <!-- Configurações do Jogo -->
          <div class="glass-panel p-5 rounded-3xl">
            <h3 class="text-base font-black text-white mb-3 flex items-center gap-2">
              <span>⚙️</span> Configurações da Partida
            </h3>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <!-- Categorias -->
              <div>
                <label class="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">Categorias Ativas</label>
                <div class="flex flex-wrap gap-1.5" id="categories-picker">
                  ${[
                    { id: "celebridades", label: "Celebridades" },
                    { id: "desenhos", label: "Desenhos" },
                    { id: "animais", label: "Animais" },
                    { id: "objetos", label: "Objetos" },
                    { id: "profissoes", label: "Profissões" }
                  ].map((cat) => `
                    <button
                      type="button"
                      data-cat="${cat.id}"
                      ${!isHost ? 'disabled' : ''}
                      class="cat-chip text-xs font-bold px-3 py-1.5 rounded-xl border transition ${
                        selectedCategories.includes(cat.id)
                          ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                          : 'bg-slate-800 border-slate-700 text-slate-400'
                      } ${!isHost ? 'opacity-75 cursor-default' : 'hover:scale-102 cursor-pointer'}"
                    >
                      ${cat.label}
                    </button>
                  `).join("")}
                </div>
              </div>

              <!-- Tempo por Turno & Rodadas -->
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">Tempo / Turno</label>
                  <select
                    id="select-turn-time"
                    ${!isHost ? 'disabled' : ''}
                    class="glass-input w-full p-2 rounded-xl text-white font-bold text-sm"
                  >
                    <option value="45" ${turnTime === 45 ? "selected" : ""}>45 seg</option>
                    <option value="60" ${turnTime === 60 ? "selected" : ""}>60 seg</option>
                    <option value="90" ${turnTime === 90 ? "selected" : ""}>90 seg</option>
                    <option value="120" ${turnTime === 120 ? "selected" : ""}>120 seg</option>
                  </select>
                </div>

                <div>
                  <label class="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">Rodadas</label>
                  <select
                    id="select-total-rounds"
                    ${!isHost ? 'disabled' : ''}
                    class="glass-input w-full p-2 rounded-xl text-white font-bold text-sm"
                  >
                    <option value="1" ${totalRounds === 1 ? "selected" : ""}>1 rodada</option>
                    <option value="2" ${totalRounds === 2 ? "selected" : ""}>2 rodadas</option>
                    <option value="3" ${totalRounds === 3 ? "selected" : ""}>3 rodadas</option>
                    <option value="5" ${totalRounds === 5 ? "selected" : ""}>5 rodadas</option>
                  </select>
                </div>
              </div>
            </div>

            <!-- Botão Iniciar Partida -->
            <div class="mt-5">
              ${isHost ? `
                <button
                  id="btn-start-game"
                  class="w-full py-3.5 px-6 rounded-2xl font-black text-slate-900 bg-gradient-to-r from-emerald-400 to-teal-400 hover:from-emerald-300 hover:to-teal-300 shadow-lg shadow-emerald-500/25 active:scale-98 transition text-base flex items-center justify-center gap-2"
                >
                  🚀 Iniciar Partida Agora!
                </button>
              ` : `
                <div class="p-3 rounded-2xl bg-slate-800/60 border border-slate-700/60 text-center text-xs text-slate-400 font-bold">
                  ⏳ Aguardando o Host (${room.players.find(p => p.id === room.hostId)?.name || 'Host'}) iniciar a partida...
                </div>
              `}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  bindLobbyEvents(isHost, selectedCategories);
}

function bindLobbyEvents(isHost, currentCategories) {
  // Sair da Sala
  document.getElementById("btn-leave-lobby")?.addEventListener("click", () => {
    state.socket.emit("leave_room");
    state.currentScreen = "home";
    renderCurrentScreen();
  });

  // Abrir Tutorial de Regras
  const btnOpenTutorial = document.getElementById("btn-open-tutorial");
  btnOpenTutorial?.addEventListener("click", () => {
    openTutorialModal(btnOpenTutorial);
  });

  // Copiar Link
  document.getElementById("btn-copy-link")?.addEventListener("click", () => {
    const joinUrl = getShareUrl(state.roomCode);
    navigator.clipboard.writeText(joinUrl).then(() => {
      showToast("Link da sala copiado com sucesso!", "success");
    }).catch(() => {
      showToast("Código da sala: " + state.roomCode, "info");
    });
  });

  // Atualização de configurações pelo Host
  if (isHost) {
    let categories = [...currentCategories];

    document.querySelectorAll(".cat-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cat = btn.dataset.cat;
        if (categories.includes(cat)) {
          if (categories.length > 1) {
            categories = categories.filter((c) => c !== cat);
          } else {
            showToast("Selecione pelo menos uma categoria!", "warning");
            return;
          }
        } else {
          categories.push(cat);
        }

        state.socket.emit("update_settings", {
          code: state.roomCode,
          settings: { categories }
        });
      });
    });

    document.getElementById("select-turn-time")?.addEventListener("change", (e) => {
      state.socket.emit("update_settings", {
        code: state.roomCode,
        settings: { turnTime: Number(e.target.value) }
      });
    });

    document.getElementById("select-total-rounds")?.addEventListener("change", (e) => {
      state.socket.emit("update_settings", {
        code: state.roomCode,
        settings: { totalRounds: Number(e.target.value) }
      });
    });

    // Iniciar Jogo
    document.getElementById("btn-start-game")?.addEventListener("click", () => {
      sound.ensureContext();
      state.socket.emit("game:start", { code: state.roomCode }, (res) => {
        if (!res?.success) {
          showToast(res?.error || "Erro ao iniciar partida.", "error");
        }
      });
    });
  }
}

// ==========================================
// 2.5 FASE DE SUGESTÃO DE PALAVRAS COM PRESERVAÇÃO DE RASCUNHO
// ==========================================
function renderWordSuggestion(container) {
  const room = state.room;
  if (!room) return;

  const isHost = room.hostId === state.myId;
  const hasSubmitted = !!room.hasSubmittedMyWord;
  const submittedCount = room.submittedCount || 0;
  const totalPlayers = room.totalPlayers || room.players.length;

  // REQUISITO: Se o formulário já existe na tela e o jogador ainda está digitando,
  // NÃO destrói o formulário nem o innerHTML para não apagar o rascunho de quem está preenchendo!
  const existingForm = document.getElementById("form-submit-word");
  if (existingForm && !hasSubmitted) {
    // Salva o que já está digitado no rascunho local
    const wordInput = document.getElementById("input-suggest-word");
    const catInput = document.getElementById("input-suggest-category");
    if (wordInput) state.wordDraft.word = wordInput.value;
    if (catInput) state.wordDraft.category = catInput.value;

    // Atualiza apenas os contadores e a lista de jogadores sem tocar nos campos
    const progressEl = document.getElementById("word-suggestion-progress");
    if (progressEl) {
      progressEl.textContent = `${submittedCount} / ${totalPlayers} Prontos`;
    }

    const listEl = document.getElementById("word-suggestion-players-list");
    if (listEl) {
      listEl.innerHTML = room.players.map((p) => {
        const isMe = p.id === state.myId;
        const isDone = p.hasSubmittedWord;
        return `
          <div class="flex items-center justify-between p-2 rounded-xl bg-slate-900/60 border ${isMe ? 'border-cyan-500/40' : 'border-slate-800'} text-xs">
            <div class="flex items-center gap-2 overflow-hidden">
              <span class="text-base">${escapeHtml(p.avatar)}</span>
              <span class="font-bold text-white truncate">${escapeHtml(p.name)} ${isMe ? '<span class="text-[10px] text-cyan-400">(Você)</span>' : ''}</span>
            </div>
            ${isDone
              ? '<span class="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold text-[10px] border border-emerald-500/30 flex items-center gap-1">✅ Enviado</span>'
              : '<span class="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold text-[10px] border border-amber-500/30 flex items-center gap-1 animate-pulse">✍️ Escrevendo...</span>'
            }
          </div>
        `;
      }).join("");
    }
    return;
  }

  container.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="glass-panel w-full max-w-2xl p-6 md:p-8 rounded-3xl shadow-2xl relative overflow-hidden">
        <!-- Detalhes de iluminação de fundo -->
        <div class="absolute -top-16 -left-16 w-36 h-36 bg-cyan-500/20 rounded-full blur-2xl"></div>
        <div class="absolute -bottom-16 -right-16 w-36 h-36 bg-amber-500/20 rounded-full blur-2xl"></div>

        <!-- Cabeçalho da Fase -->
        <div class="text-center mb-6">
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/20 text-cyan-300 text-xs font-black uppercase tracking-wider mb-2 border border-cyan-500/30">
            <span>Rodada ${room.currentRound} de ${room.settings?.totalRounds || 3}</span>
            <span>•</span>
            <span>Preparação de Palavras</span>
          </div>
          <h1 class="text-2xl md:text-3xl font-black text-white m-0">Escreva uma Palavra Secreta ✍️</h1>
          <p class="text-xs md:text-sm text-slate-300 mt-1 max-w-lg mx-auto">
            Sua palavra será sorteada e colocada na testa de outro participante.
            <strong class="text-amber-300 block mt-0.5">Regra de Ouro: Ninguém recebe a própria palavra que escreveu!</strong>
          </p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
          <!-- Coluna Esquerda: Formulário de Envio ou Status do Jogador Local -->
          <div class="md:col-span-7 glass-panel p-5 rounded-2xl border border-slate-700/60">
            ${hasSubmitted ? `
              <div class="text-center py-6">
                <div class="text-5xl mb-3 animate-bounce">🔒</div>
                <h3 class="text-lg font-black text-emerald-400 m-0">Palavra Secreta Enviada!</h3>
                <div class="my-4 p-3 rounded-xl bg-slate-900/80 border border-slate-700">
                  <span class="block text-[11px] font-bold text-slate-400 uppercase tracking-wider">Você sugeriu:</span>
                  <span class="text-xl font-black text-white">${escapeHtml(room.mySubmittedWord || "Palavra Oculta")}</span>
                </div>
                <p class="text-xs text-slate-400">
                  Shhh! Segredo absoluto! Aguarde enquanto os outros participantes terminam de enviar suas palavras.
                </p>
              </div>
            ` : `
              <form id="form-submit-word" class="space-y-4" onsubmit="return false;">
                <div>
                  <label class="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                    Palavra Secreta / Personagem *
                  </label>
                  <input
                    type="text"
                    id="input-suggest-word"
                    maxlength="40"
                    placeholder="Ex: Silvio Santos, Bob Esponja, Capivara..."
                    value="${escapeHtml(state.wordDraft?.word || '')}"
                    autocomplete="off"
                    class="glass-input w-full px-4 py-3 rounded-xl text-white font-bold text-base focus:ring-2 focus:ring-cyan-400 transition"
                  />
                </div>

                <div>
                  <label class="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                    Dica ou Categoria (Opcional)
                  </label>
                  <input
                    type="text"
                    id="input-suggest-category"
                    maxlength="30"
                    placeholder="Ex: Celebridade, Desenho, Animal, Amigo..."
                    value="${escapeHtml(state.wordDraft?.category || '')}"
                    autocomplete="off"
                    class="glass-input w-full px-4 py-2.5 rounded-xl text-white text-sm"
                  />
                </div>

                <button
                  type="submit"
                  id="btn-send-suggest-word"
                  class="w-full py-3.5 px-6 rounded-2xl font-black text-slate-900 bg-gradient-to-r from-cyan-400 to-teal-400 hover:from-cyan-300 hover:to-teal-300 shadow-lg shadow-cyan-500/25 active:scale-98 transition flex items-center justify-center gap-2 text-sm"
                >
                  🔒 Enviar Palavra Secreta
                </button>
              </form>
            `}
          </div>

          <!-- Coluna Direita: Status dos Jogadores Conectados -->
          <div class="md:col-span-5 glass-panel p-4 rounded-2xl border border-slate-700/60 flex flex-col">
            <div class="flex items-center justify-between mb-3 pb-2 border-b border-slate-700/50">
              <span class="text-xs font-bold uppercase text-slate-400">Progresso</span>
              <span id="word-suggestion-progress" class="text-xs font-black text-cyan-300">${submittedCount} / ${totalPlayers} Prontos</span>
            </div>

            <!-- Lista de Jogadores -->
            <div id="word-suggestion-players-list" class="space-y-2 overflow-y-auto max-h-48 pr-1">
              ${room.players.map((p) => {
                const isMe = p.id === state.myId;
                const isDone = p.hasSubmittedWord;
                return `
                  <div class="flex items-center justify-between p-2 rounded-xl bg-slate-900/60 border ${isMe ? 'border-cyan-500/40' : 'border-slate-800'} text-xs">
                    <div class="flex items-center gap-2 overflow-hidden">
                      <span class="text-base">${escapeHtml(p.avatar)}</span>
                      <span class="font-bold text-white truncate">${escapeHtml(p.name)} ${isMe ? '<span class="text-[10px] text-cyan-400">(Você)</span>' : ''}</span>
                    </div>
                    ${isDone
                      ? '<span class="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold text-[10px] border border-emerald-500/30 flex items-center gap-1">✅ Enviado</span>'
                      : '<span class="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold text-[10px] border border-amber-500/30 flex items-center gap-1 animate-pulse">✍️ Escrevendo...</span>'
                    }
                  </div>
                `;
              }).join("")}
            </div>

            <!-- Botão Host para forçar início se alguém demorar -->
            ${isHost && totalPlayers >= 2 ? `
              <div class="mt-4 pt-3 border-t border-slate-700/50">
                <button
                  id="btn-force-distribute"
                  class="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold border border-slate-600 transition"
                  title="Inicia a rodada preenchendo automaticamente quem não enviou"
                >
                  ⚡ Iniciar Rodada Agora
                </button>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    </div>
  `;

  bindWordSuggestionEvents(hasSubmitted);
}

function bindWordSuggestionEvents(hasSubmitted) {
  if (!hasSubmitted) {
    const wordInput = document.getElementById("input-suggest-word");
    const catInput = document.getElementById("input-suggest-category");

    // Sincroniza digitação em tempo real no rascunho local
    wordInput?.addEventListener("input", (e) => {
      state.wordDraft.word = e.target.value;
    });
    catInput?.addEventListener("input", (e) => {
      state.wordDraft.category = e.target.value;
    });

    const form = document.getElementById("form-submit-word");
    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      const word = wordInput?.value?.trim();
      const category = catInput?.value?.trim() || "Geral";

      if (!word || word.length < 2) {
        showToast("Por favor, digite uma palavra com pelo menos 2 letras.", "warning");
        wordInput?.focus();
        return;
      }

      sound.ensureContext();
      state.socket.emit("word:submit", {
        code: state.roomCode,
        word,
        category
      }, (res) => {
        if (res && !res.success) {
          showToast(res.error || "Erro ao enviar palavra.", "error");
        } else {
          // Limpa o rascunho local após envio com sucesso
          state.wordDraft = { word: "", category: "" };
          showToast("Palavra secreta enviada com sucesso!", "success");
        }
      });
    });
  }

  document.getElementById("btn-force-distribute")?.addEventListener("click", () => {
    if (confirm("Deseja iniciar a rodada agora? (Quem não enviou receberá uma palavra automática)")) {
      sound.ensureContext();
      state.socket.emit("game:distribute", { code: state.roomCode });
    }
  });
}

// ==========================================
// 3. TELA DE JOGO COM REGRAS ESTRITAS DE TURNO
// ==========================================
function renderGame(container) {
  const room = state.room;
  if (!room) return;

  const prevChatContainer = document.getElementById("chat-messages-container");
  const chatScrollSnapshot = prevChatContainer
    ? {
        wasAtBottom: shouldFollowChatScroll(
          prevChatContainer.scrollTop,
          prevChatContainer.scrollHeight,
          prevChatContainer.clientHeight
        ),
        scrollTop: prevChatContainer.scrollTop
      }
    : null;

  const isMyTurn = room.activePlayerId === state.myId;
  const isCelebration = room.state === "turn_celebration";
  const activePlayer = room.players.find((p) => p.id === room.activePlayerId);
  const myPlayer = room.players.find((p) => p.id === state.myId);
  const turnSeconds = room.turnSecondsRemaining ?? room.settings?.turnTime ?? 60;
  const totalSeconds = room.settings?.turnTime || 60;
  const timePercent = Math.max(0, Math.min(100, (turnSeconds / totalSeconds) * 100));

  const turnPhase = room.turnPhase || "awaiting_question";
  const currentQuestion = room.currentQuestion || null;
  const turnResult = room.turnResult || null;
  const wordRevealed = room.wordRevealed || null;

  // Placeholder inteligente do chat de acordo com a fase
  let chatPlaceholder = "Envie uma dica ou converse...";
  if (isMyTurn) {
    if (turnPhase === "awaiting_question") {
      chatPlaceholder = "Passo 1: Digite sua pergunta da vez...";
    } else if (turnPhase === "awaiting_responses") {
      chatPlaceholder = "Aguardando respostas dos amigos...";
    } else if (turnPhase === "awaiting_guess_or_pass") {
      chatPlaceholder = "Digite seu palpite único aqui ou no cartão...";
    }
  }

  container.innerHTML = `
    <div class="h-screen max-h-screen flex flex-col p-2 md:p-3 max-w-7xl mx-auto overflow-hidden">
      <!-- Barra Superior: Info da Rodada e Cronômetro -->
      <header class="glass-panel px-4 py-2 rounded-2xl mb-2 flex items-center justify-between gap-3 flex-shrink-0">
        <div class="flex items-center gap-2">
          <span class="px-2.5 py-1 rounded-xl bg-cyan-500/20 text-cyan-300 font-black text-xs md:text-sm border border-cyan-500/30">
            Rodada ${room.currentRound} de ${room.settings?.totalRounds || 3}
          </span>
          <span class="text-xs text-slate-400 font-bold hidden sm:inline">Sala: ${room.code}</span>
        </div>

        <!-- Cronômetro Central -->
        <div class="flex-1 max-w-md mx-2 flex flex-col items-center">
          <div class="flex items-center gap-2 mb-0.5">
            <span class="text-xs font-bold text-slate-300">Tempo:</span>
            <span id="timer-seconds-display" class="font-black text-sm md:text-base ${turnSeconds <= 10 ? 'text-rose-400 animate-pulse' : 'text-cyan-300'}">
              ${turnSeconds}s
            </span>
          </div>
          <div class="w-full bg-slate-800 rounded-full h-2 overflow-hidden border border-slate-700/60">
            <div
              id="timer-progress-bar"
              class="h-full transition-all duration-1000 rounded-full ${turnSeconds <= 10 ? 'bg-rose-500' : turnSeconds <= 25 ? 'bg-amber-400' : 'bg-gradient-to-r from-cyan-400 to-teal-400'}"
              style="width: ${timePercent}%"
            ></div>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button id="btn-toggle-sound-game" class="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition" title="Alternar Som">
            ${state.soundEnabled ? "🔊" : "🔇"}
          </button>
          <button id="btn-leave-game" class="px-3 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs font-bold border border-rose-500/30 transition">
            Sair
          </button>
        </div>
      </header>

      <!-- Layout Principal: 3 Colunas com rolagem interna estrita (3/12 Placar, 4/12 Palco Central, 5/12 Chat) -->
      <div class="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3 min-h-0 overflow-y-auto lg:overflow-hidden pb-1">
        <!-- Coluna Esquerda: Placar e Jogadores Conectados (${BOARD_LAYOUT_SPANS.scoreboard}/12) -->
        <div class="lg:col-span-${BOARD_LAYOUT_SPANS.scoreboard} glass-panel p-3 rounded-3xl flex flex-col max-h-[220px] lg:max-h-full min-h-0 overflow-hidden flex-shrink-0">
          <h3 class="text-xs font-black uppercase text-slate-400 tracking-wider mb-2 flex items-center justify-between flex-shrink-0">
            <span>Classificação</span>
            <span>🏆 Pontos</span>
          </h3>

          <div class="flex-1 overflow-y-auto space-y-1.5 pr-1 scrollbar-thin">
            ${[...room.players]
              .sort((a, b) => b.score - a.score)
              .map((p, idx) => {
                const isActive = p.id === room.activePlayerId;
                const isMe = p.id === state.myId;
                return `
                  <div class="flex items-center justify-between p-2 rounded-2xl transition border ${
                    isActive
                      ? 'bg-cyan-950/50 border-cyan-400 shadow-md shadow-cyan-500/20 active-turn-ring'
                      : isMe
                      ? 'bg-slate-800/80 border-slate-600'
                      : 'bg-slate-900/50 border-slate-800'
                  }">
                    <div class="flex items-center gap-2 overflow-hidden">
                      <span class="text-xs font-black text-slate-400 w-4">${idx + 1}º</span>
                      <span class="text-lg">${escapeHtml(p.avatar)}</span>
                      <div class="overflow-hidden">
                        <p class="text-xs font-bold text-white truncate m-0 flex items-center gap-1">
                          ${escapeHtml(p.name)}
                          ${isMe ? '<span class="text-[9px] text-cyan-300">(Você)</span>' : ''}
                        </p>
                        ${isActive ? '<span class="text-[9px] font-black text-cyan-400">VEZ DELE(A) 🎯</span>' : ''}
                      </div>
                    </div>
                    <span class="font-black text-xs text-amber-300 ml-2">${p.score}</span>
                  </div>
                `;
              })
              .join("")}
          </div>
        </div>

        <!-- Coluna Central: A MESA E O CARTÃO NA TESTA (${BOARD_LAYOUT_SPANS.centerStage}/12) -->
        <div class="lg:col-span-${BOARD_LAYOUT_SPANS.centerStage} flex flex-col gap-2 min-h-0 flex-shrink-0 lg:flex-shrink">
          <div class="glass-panel p-4 md:p-5 rounded-3xl flex-1 flex flex-col items-center justify-center text-center relative overflow-hidden">
            ${isCelebration ? `
              <!-- ESTADO DE CELEBRAÇÃO / TRANSIÇÃO ENTRE TURNOS -->
              <div class="w-full flex flex-col items-center p-5 rounded-3xl bg-slate-900/90 border-2 ${
                turnResult?.outcome === 'correct' ? 'border-amber-400 shadow-xl shadow-amber-500/20' : 'border-rose-500/60 shadow-xl shadow-rose-500/20'
              }">
                <div class="text-4xl md:text-5xl mb-2 animate-bounce">
                  ${turnResult?.outcome === 'correct' ? '🎉' : turnResult?.outcome === 'timeout' ? '⏰' : turnResult?.outcome === 'skipped' ? '⏭️' : '❌'}
                </div>
                <h2 class="text-lg md:text-2xl font-black text-white m-0">
                  ${
                    turnResult?.outcome === 'correct'
                      ? `PARABÉNS! ${escapeHtml(turnResult.player)} ACERTOU!`
                      : turnResult?.outcome === 'timeout'
                      ? `TEMPO ESGOTADO PARA ${escapeHtml(turnResult.player)}!`
                      : turnResult?.outcome === 'skipped'
                      ? `${escapeHtml(turnResult.player)} PASSOU A VEZ!`
                      : `${escapeHtml(turnResult.player)} ERROU O PALPITE!`
                  }
                </h2>
                
                <div class="my-3 px-6 py-2.5 rounded-2xl bg-slate-800/90 border border-slate-700 text-center max-w-sm w-full">
                  ${turnResult?.outcome === 'correct' && wordRevealed ? `
                    <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">A palavra secreta era:</span>
                    <span class="text-xl md:text-2xl font-black text-cyan-300 tracking-wide">${escapeHtml(wordRevealed)}</span>
                  ` : `
                    <span class="text-xs font-bold text-slate-300 block">🔒 A palavra continua secreta para a próxima tentativa na fila!</span>
                  `}
                </div>

                ${turnResult?.outcome === 'correct' ? `
                  <p class="text-xs font-black text-amber-300 m-0">+${turnResult.points || 100} pontos conquistados!</p>
                ` : ''}

                <div class="mt-4 flex items-center gap-1.5 text-xs text-slate-300 font-bold">
                  <span class="animate-spin inline-block">⏳</span> Preparando o próximo jogador...
                </div>
              </div>
            ` : isMyTurn ? `
              <!-- VOCÊ É O JOGADOR DA VEZ (NÃO VÊ A SUA PRÓPRIA PALAVRA) -->
              <div class="w-full flex flex-col items-center card-my-forehead p-5 rounded-3xl bg-gradient-to-b from-amber-500/20 to-slate-900/60 border-2 border-amber-400/60">
                <div class="text-3xl md:text-4xl mb-1 animate-bounce">❓</div>
                <span class="px-3 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-black uppercase tracking-wider mb-2 border border-amber-500/40">
                  SUA PALAVRA NA TESTA
                </span>
                <h2 class="text-xl md:text-3xl font-black text-white m-0 tracking-wide">QUEM SOU?</h2>
                <p class="text-xs font-bold text-cyan-300 mt-1">
                  🌟 Categoria: ${escapeHtml(myPlayer?.currentWord?.categoriaNome || "Geral")}
                </p>
              </div>

              <!-- CONTROLE DO TURNO SEGUNDO A MÁQUINA DE ESTADOS -->
              <div class="w-full mt-3">
                ${turnPhase === "awaiting_question" ? `
                  <!-- FASE 1: PERGUNTA OBRIGATÓRIA -->
                  <div class="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-left">
                    <span class="text-xs font-black text-amber-300 flex items-center gap-1">
                      <span>❓</span> Passo 1 de 2: Formule sua pergunta
                    </span>
                    <p class="text-[11px] text-slate-300 mt-1 mb-2">
                      Você pode fazer <strong>1 pergunta</strong> por turno para descobrir quem você é.
                    </p>
                    <form id="form-card-question" class="flex gap-2">
                      <input
                        type="text"
                        id="input-card-question"
                        maxlength="100"
                        placeholder="Ex: Eu sou uma pessoa real? Eu sou homem?"
                        class="glass-input flex-1 px-3 py-2 rounded-xl text-white text-xs font-medium focus:ring-1 focus:ring-amber-400"
                      />
                      <button
                        type="submit"
                        class="px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 font-black text-slate-900 text-xs transition"
                      >
                        Perguntar ❓
                      </button>
                    </form>
                  </div>
                ` : turnPhase === "awaiting_responses" ? `
                  <!-- FASE 2: AGUARDANDO RESPOSTAS DOS AMIGOS -->
                  <div class="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-center animate-pulse">
                    <span class="text-xs font-black text-amber-300 block mb-1">⏳ Passo 2: Aguardando respostas dos amigos...</span>
                    <div class="p-2 my-1 rounded-xl bg-slate-900/80 border border-slate-700 text-xs text-white font-bold">
                      "${escapeHtml(currentQuestion || "Sua pergunta")}"
                    </div>
                    <span class="text-[10px] text-slate-400 block mt-1">
                      Assim que alguém responder SIM, NÃO ou TALVEZ, você poderá escolher entre palpitar ou passar!
                    </span>
                  </div>
                ` : `
                  <!-- FASE 3: ESCOLHA ENTRE PALPITE ÚNICO OU PASSAR A VEZ -->
                  <div class="p-3 rounded-2xl bg-slate-800/80 border border-cyan-500/40 text-left">
                    <div class="flex items-center justify-between mb-1.5">
                      <span class="text-xs font-black text-cyan-300 flex items-center gap-1">
                        <span>🎯</span> Passo 3: Escolha sua ação!
                      </span>
                      <span class="text-[10px] font-bold text-amber-400">1 tentativa</span>
                    </div>

                    <form id="form-card-guess" class="flex gap-2 mb-2">
                      <input
                        type="text"
                        id="input-card-guess"
                        maxlength="40"
                        placeholder="Digite o nome exato de quem você é..."
                        class="glass-input flex-1 px-3 py-2 rounded-xl text-white text-xs font-bold focus:ring-1 focus:ring-cyan-400"
                      />
                      <button
                        type="submit"
                        id="btn-confirm-guess"
                        class="px-3.5 py-2 rounded-xl bg-gradient-to-r from-cyan-400 to-teal-400 hover:from-cyan-300 text-slate-900 font-black text-xs transition active:scale-95 shadow-md shadow-cyan-500/20"
                      >
                        Palpitar 🎯
                      </button>
                    </form>

                    <div class="flex items-center justify-between pt-2 border-t border-slate-700/60">
                      <span class="text-[10px] text-rose-300 font-semibold">⚠️ Errou? A vez passa na hora!</span>
                      <button
                        type="button"
                        id="btn-action-skip"
                        class="px-3 py-1.5 rounded-xl bg-slate-700/80 hover:bg-slate-700 text-slate-200 text-xs font-bold transition active:scale-95"
                      >
                        Passar a Vez ⏭️
                      </button>
                    </div>
                  </div>
                `}
              </div>
            ` : `
              <!-- OUTRO JOGADOR É A VEZ: VOCÊ VÊ A PALAVRA DELE NA TESTA! -->
              <div class="w-full flex flex-col items-center p-5 rounded-3xl bg-gradient-to-b from-cyan-500/20 to-slate-900/60 border-2 border-cyan-400/50">
                <div class="text-3xl mb-1">${escapeHtml(activePlayer?.avatar || "👤")}</div>
                <span class="text-xs font-bold text-slate-300 mb-0.5">
                  É a vez de <strong class="text-cyan-300 font-black">${escapeHtml(activePlayer?.name || "Jogador")}</strong>
                </span>
                <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                  Categoria: ${escapeHtml(activePlayer?.currentWord?.categoriaNome || "Geral")}
                </span>

                <!-- PALAVRA REVELADA NA TESTA DELE -->
                <div class="bg-white/95 text-slate-900 px-5 py-3 rounded-2xl shadow-xl w-full max-w-md">
                  <span class="block text-[9px] font-black uppercase text-slate-500 tracking-wider">A Palavra Secreta dele(a) é:</span>
                  <h2 class="text-xl md:text-2xl font-black m-0 text-slate-900 tracking-tight break-words">
                    ${escapeHtml(activePlayer?.currentWord?.palavra || "Sorteando...")}
                  </h2>
                </div>
              </div>

              <!-- ÁREA DE RESPOSTAS RÁPIDAS PARA ESPECTADORES -->
              <div class="w-full mt-2.5">
                ${turnPhase === "awaiting_question" ? `
                  <div class="p-2 rounded-xl bg-slate-800/60 border border-slate-700 text-center">
                    <span class="text-xs text-slate-400 font-bold">
                      ⏳ Aguardando ${escapeHtml(activePlayer?.name || "Jogador")} fazer a pergunta da vez...
                    </span>
                  </div>
                ` : turnPhase === "awaiting_responses" ? `
                  <div class="p-2.5 rounded-2xl bg-cyan-950/40 border border-cyan-400/40 mb-2 text-left">
                    <span class="text-[11px] font-black text-cyan-300 block">
                      ❓ Pergunta de ${escapeHtml(activePlayer?.name || "Jogador")}:
                    </span>
                    <p class="text-xs font-bold text-white m-0 mt-0.5">"${escapeHtml(currentQuestion || "")}"</p>
                  </div>
                ` : `
                  <div class="p-2 rounded-xl bg-slate-800/60 border border-slate-700 text-center mb-2">
                    <span class="text-xs text-cyan-300 font-bold">
                      🎯 ${escapeHtml(activePlayer?.name || "Jogador")} está escolhendo entre palpitar ou passar!
                    </span>
                  </div>
                `}

                <!-- BOTÕES DE RESPOSTA RÁPIDA (1 TOQUE, ZERO SONS INCÔMODOS) -->
                <div class="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    data-quick-reaction="yes"
                    ${turnPhase === "awaiting_question" ? "disabled" : ""}
                    class="py-2.5 px-2 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-black text-xs md:text-sm flex items-center justify-center gap-1 shadow-md shadow-emerald-950/40 transition ${
                      turnPhase === "awaiting_question" ? "opacity-40 cursor-not-allowed" : "hover:bg-emerald-500/30 active:scale-95 cursor-pointer"
                    }"
                  >
                    👍 SIM
                  </button>
                  <button
                    type="button"
                    data-quick-reaction="no"
                    ${turnPhase === "awaiting_question" ? "disabled" : ""}
                    class="py-2.5 px-2 rounded-2xl bg-rose-500/20 border border-rose-500/40 text-rose-300 font-black text-xs md:text-sm flex items-center justify-center gap-1 shadow-md shadow-rose-950/40 transition ${
                      turnPhase === "awaiting_question" ? "opacity-40 cursor-not-allowed" : "hover:bg-rose-500/30 active:scale-95 cursor-pointer"
                    }"
                  >
                    👎 NÃO
                  </button>
                  <button
                    type="button"
                    data-quick-reaction="maybe"
                    ${turnPhase === "awaiting_question" ? "disabled" : ""}
                    class="py-2.5 px-2 rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-300 font-black text-xs md:text-sm flex items-center justify-center gap-1 shadow-md shadow-amber-950/40 transition ${
                      turnPhase === "awaiting_question" ? "opacity-40 cursor-not-allowed" : "hover:bg-amber-500/30 active:scale-95 cursor-pointer"
                    }"
                  >
                    🤔 TALVEZ
                  </button>
                </div>
              </div>
            `}
          </div>
        </div>

        <!-- Coluna Direita: O CHAT COM ROLAGEM INTERNA CONTIDA (${BOARD_LAYOUT_SPANS.chat}/12) -->
        <div class="lg:col-span-${BOARD_LAYOUT_SPANS.chat} glass-panel p-3 rounded-3xl flex flex-col h-[340px] lg:h-full min-h-0 overflow-hidden flex-shrink-0">
          <div class="flex items-center justify-between pb-1.5 mb-1.5 border-b border-slate-700/50 flex-shrink-0">
            <h3 class="text-xs font-black uppercase text-slate-300 tracking-wider m-0 flex items-center gap-1.5">
              <span>💬</span> Chat da Sala
            </h3>
            <span class="text-[10px] text-cyan-400 font-bold">1 Pergunta • 1 Palpite</span>
          </div>

          <!-- Feed de Mensagens com Rolagem Interna Inteligente (Não expande a página) -->
          <div id="chat-messages-container" class="flex-1 min-h-0 overflow-y-auto space-y-1 pr-1 overscroll-contain scrollbar-thin">
            <!-- Mensagens renderizadas dinamicamente -->
          </div>

          <!-- Caixa de Entrada de Texto do Chat -->
          <form id="chat-form" class="mt-2 flex gap-1.5 flex-shrink-0" onsubmit="return false;">
            <input
              type="text"
              id="chat-input"
              maxlength="100"
              autocomplete="off"
              placeholder="${chatPlaceholder}"
              class="glass-input flex-1 px-3 py-2 rounded-xl text-white text-xs font-medium focus:ring-1 focus:ring-cyan-400"
            />
            <button
              type="submit"
              id="btn-send-chat"
              class="px-3.5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-black text-xs active:scale-95 transition flex items-center justify-center shadow-md shadow-cyan-500/20 flex-shrink-0"
            >
              Enviar 💬
            </button>
          </form>
        </div>
      </div>
    </div>
  `;

  bindGameEvents(isMyTurn, turnPhase);
  populateInitialChat(chatScrollSnapshot);
}

function bindGameEvents(isMyTurn, turnPhase) {
  // Sair do jogo
  document.getElementById("btn-leave-game")?.addEventListener("click", () => {
    if (confirm("Deseja realmente sair da partida?")) {
      state.socket.emit("leave_room");
      state.currentScreen = "home";
      renderCurrentScreen();
    }
  });

  // Alternar som
  document.getElementById("btn-toggle-sound-game")?.addEventListener("click", () => {
    toggleSound();
    renderCurrentScreen();
  });

  // Ações do Jogador Ativo no Cartão Central:
  if (isMyTurn) {
    // 1. Enviar pergunta no formulário do cartão
    const questionForm = document.getElementById("form-card-question");
    questionForm?.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = document.getElementById("input-card-question");
      const text = input?.value?.trim();
      if (!text) return;

      sound.ensureContext();
      state.socket.emit("chat_message", { code: state.roomCode, text });
      input.value = "";
    });

    // 2. Enviar palpite único no formulário do cartão
    const guessForm = document.getElementById("form-card-guess");
    guessForm?.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = document.getElementById("input-card-guess");
      const text = input?.value?.trim();
      if (!text) return;

      sendPlayerGuess(text);
      input.value = "";
    });

    // 3. Passar a vez diretamente (sem modal intrusivo)
    document.getElementById("btn-action-skip")?.addEventListener("click", () => {
      state.socket.emit("skip_turn", { code: state.roomCode });
    });
  }

  // Reações Rápidas (SIM, NÃO, TALVEZ) para espectadores
  document.querySelectorAll("[data-quick-reaction]").forEach((btn) => {
    btn.addEventListener("click", () => {
      sendQuickReaction(btn.dataset.quickReaction);
    });
  });

  // Envio pelo formulário do chat
  const chatForm = document.getElementById("chat-form");
  chatForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    sendChatMessage();
  });
}

function populateInitialChat(snapshot = null) {
  const container = document.getElementById("chat-messages-container");
  if (!container || !state.chatMessages) return;

  container.innerHTML = "";
  state.chatMessages.forEach((msg) => {
    container.appendChild(renderMessageElement(msg));
  });

  if (snapshot) {
    container.scrollTop = calculateRestoredScrollPosition({
      wasAtBottom: snapshot.wasAtBottom,
      previousScrollTop: snapshot.scrollTop,
      newScrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight
    });
  } else {
    container.scrollTop = container.scrollHeight;
  }
}

// Atualização precisa do temporizador sem re-renderizar a tela toda
export function updateTimerUI(secondsRemaining, totalSeconds) {
  const secondsDisplay = document.getElementById("timer-seconds-display");
  const progressBar = document.getElementById("timer-progress-bar");

  if (secondsDisplay) {
    secondsDisplay.textContent = `${secondsRemaining}s`;
    if (secondsRemaining <= 10) {
      secondsDisplay.className = "font-black text-sm md:text-base text-rose-400 animate-pulse";
    } else {
      secondsDisplay.className = "font-black text-sm md:text-base text-cyan-300";
    }
  }

  if (progressBar) {
    const percent = Math.max(0, Math.min(100, (secondsRemaining / (totalSeconds || 60)) * 100));
    progressBar.style.width = `${percent}%`;

    if (secondsRemaining <= 10) {
      progressBar.className = "h-full transition-all duration-1000 rounded-full bg-rose-500";
    } else if (secondsRemaining <= 25) {
      progressBar.className = "h-full transition-all duration-1000 rounded-full bg-amber-400";
    } else {
      progressBar.className = "h-full transition-all duration-1000 rounded-full bg-gradient-to-r from-cyan-400 to-teal-400";
    }
  }
}

// ==========================================
// 4. TELA DE PÓDIO (FIM DE JOGO)
// ==========================================
function renderPodium(container) {
  const room = state.room;
  if (!room) return;

  const isHost = room.hostId === state.myId;
  const sortedPlayers = [...room.players].sort((a, b) => b.score - a.score);
  const winner = sortedPlayers[0];
  const second = sortedPlayers[1];
  const third = sortedPlayers[2];

  container.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="glass-panel w-full max-w-2xl p-6 md:p-8 rounded-3xl shadow-2xl text-center relative overflow-hidden">
        <h1 class="text-3xl md:text-4xl font-black text-white mb-1">🏆 PÓDIO DOS VENCEDORES</h1>
        <p class="text-xs md:text-sm text-slate-400 mb-6">Fim da partida! Parabéns a todos os mestres da adivinhação!</p>

        <!-- O Pódio Visual -->
        <div class="flex items-end justify-center gap-3 my-6 pt-4">
          <!-- 2º Lugar -->
          ${second ? `
            <div class="flex-1 flex flex-col items-center">
              <span class="text-3xl mb-1">${escapeHtml(second.avatar)}</span>
              <p class="text-xs md:text-sm font-bold text-white truncate max-w-[100px] m-0">${escapeHtml(second.name)}</p>
              <span class="text-xs font-black text-slate-300 mb-2">${second.score} pts</span>
              <div class="w-full bg-slate-700/80 rounded-t-2xl h-24 flex items-center justify-center border-t-2 border-slate-400">
                <span class="text-2xl font-black text-slate-300">🥈 2º</span>
              </div>
            </div>
          ` : '<div class="flex-1"></div>'}

          <!-- 1º Lugar -->
          ${winner ? `
            <div class="flex-1 flex flex-col items-center">
              <div class="text-4xl md:text-5xl mb-1 animate-bounce">👑</div>
              <span class="text-4xl mb-1">${escapeHtml(winner.avatar)}</span>
              <p class="text-sm md:text-base font-black text-amber-300 truncate max-w-[120px] m-0">${escapeHtml(winner.name)}</p>
              <span class="text-sm font-black text-white mb-2">${winner.score} pts</span>
              <div class="w-full bg-gradient-to-t from-amber-600/80 to-amber-500 rounded-t-2xl h-36 flex items-center justify-center shadow-lg shadow-amber-500/20 border-t-2 border-amber-300">
                <span class="text-3xl font-black text-white">🥇 1º</span>
              </div>
            </div>
          ` : ''}

          <!-- 3º Lugar -->
          ${third ? `
            <div class="flex-1 flex flex-col items-center">
              <span class="text-3xl mb-1">${escapeHtml(third.avatar)}</span>
              <p class="text-xs md:text-sm font-bold text-white truncate max-w-[100px] m-0">${escapeHtml(third.name)}</p>
              <span class="text-xs font-black text-amber-500 mb-2">${third.score} pts</span>
              <div class="w-full bg-amber-900/60 rounded-t-2xl h-16 flex items-center justify-center border-t-2 border-amber-600">
                <span class="text-xl font-black text-amber-500">🥉 3º</span>
              </div>
            </div>
          ` : '<div class="flex-1"></div>'}
        </div>

        <!-- Tabela Completa -->
        <div class="glass-panel p-4 rounded-2xl my-5 text-left max-h-48 overflow-y-auto">
          <h3 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Classificação Geral</h3>
          <div class="space-y-1.5">
            ${sortedPlayers.map((p, i) => `
              <div class="flex items-center justify-between text-xs md:text-sm p-2 rounded-xl bg-slate-800/50">
                <span class="font-bold text-slate-300 flex items-center gap-2">
                  <span class="font-black text-slate-500 w-4">${i + 1}º</span>
                  <span>${escapeHtml(p.avatar)}</span>
                  <span>${escapeHtml(p.name)}</span>
                </span>
                <span class="font-black text-amber-400">${p.score} pontos</span>
              </div>
            `).join("")}
          </div>
        </div>

        <!-- Ações do Pódio -->
        <div class="flex flex-col sm:flex-row gap-3 justify-center">
          ${isHost ? `
            <button
              id="btn-restart-game"
              class="py-3 px-6 rounded-2xl font-black text-slate-900 bg-gradient-to-r from-cyan-400 to-teal-400 hover:from-cyan-300 hover:to-teal-300 shadow-lg shadow-cyan-500/25 active:scale-98 transition text-sm flex items-center justify-center gap-2"
            >
              🔄 Jogar Novamente!
            </button>
          ` : `
            <p class="text-xs text-slate-400">Aguardando o Host reiniciar uma nova partida...</p>
          `}
          <button
            id="btn-back-home"
            class="py-3 px-6 rounded-2xl font-bold text-slate-300 bg-slate-800 hover:bg-slate-700 active:scale-98 transition text-sm"
          >
            Sair para o Início
          </button>
        </div>
      </div>
    </div>
  `;

  document.getElementById("btn-restart-game")?.addEventListener("click", () => {
    sound.ensureContext();
    state.socket.emit("restart_game", { code: state.roomCode });
  });

  document.getElementById("btn-back-home")?.addEventListener("click", () => {
    state.socket.emit("leave_room");
    state.currentScreen = "home";
    renderCurrentScreen();
  });
}

// Toast Notificações Flutuantes
export function showToast(message, type = "info") {
  const toastContainer = document.getElementById("toast-container");
  if (!toastContainer) return;

  const toast = document.createElement("div");
  let bg = "bg-slate-800 text-white border-slate-700";
  if (type === "success") bg = "bg-emerald-600 text-white border-emerald-500 shadow-lg shadow-emerald-600/30";
  if (type === "error") bg = "bg-rose-600 text-white border-rose-500 shadow-lg shadow-rose-600/30";
  if (type === "warning") bg = "bg-amber-500 text-slate-900 font-bold border-amber-400 shadow-lg shadow-amber-500/30";

  toast.className = `px-4 py-3 rounded-2xl border text-xs md:text-sm font-bold shadow-xl transition transform duration-300 flex items-center gap-2 pointer-events-auto ${bg} animate-bounce`;
  toast.innerHTML = `<span>${escapeHtml(message)}</span>`;

  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-10px)";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Animação de Confetes nativa com Canvas 2D
export function triggerConfetti() {
  const canvas = document.getElementById("confetti-canvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const confettiCount = 100;
  const confetti = [];
  const colors = ["#06b6d4", "#f59e0b", "#ec4899", "#10b981", "#8b5cf6", "#ffffff"];

  for (let i = 0; i < confettiCount; i++) {
    confetti.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height - canvas.height,
      r: Math.random() * 6 + 4,
      d: Math.random() * confettiCount,
      color: colors[Math.floor(Math.random() * colors.length)],
      tilt: Math.floor(Math.random() * 10) - 10,
      tiltAngleIncremental: Math.random() * 0.07 + 0.05,
      tiltAngle: 0
    });
  }

  let animationFrame;
  let duration = 180; // ~3 segundos

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < confetti.length; i++) {
      const p = confetti[i];
      ctx.beginPath();
      ctx.lineWidth = p.r;
      ctx.strokeStyle = p.color;
      ctx.moveTo(p.x + p.tilt + p.r / 2, p.y);
      ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 2);
      ctx.stroke();

      p.tiltAngle += p.tiltAngleIncremental;
      p.y += (Math.cos(p.d) + 3 + p.r / 2) / 2;
      p.x += Math.sin(p.d);
      p.tilt = Math.sin(p.tiltAngle - i / 3) * 15;
    }

    duration--;
    if (duration > 0) {
      animationFrame = requestAnimationFrame(draw);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      cancelAnimationFrame(animationFrame);
    }
  }

  draw();
}
