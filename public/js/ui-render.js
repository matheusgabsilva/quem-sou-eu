import { state, saveLocalPlayer, toggleSound } from "./state.js";
import { sound } from "./audio.js";
import { escapeHtml, sendChatMessage, sendQuickReaction } from "./chat.js";

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
  // Pega código da URL caso tenha vindo via QR code ou link compartilhado
  const urlParams = new URLSearchParams(window.location.search);
  const roomQuery = (urlParams.get("room") || "").toUpperCase();

  container.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="glass-panel w-full max-w-md p-6 md:p-8 rounded-3xl shadow-2xl relative overflow-hidden">
        <!-- Detalhe decorativo no topo -->
        <div class="absolute -top-12 -left-12 w-32 h-32 bg-cyan-500/20 rounded-full blur-2xl"></div>
        <div class="absolute -bottom-12 -right-12 w-32 h-32 bg-pink-500/20 rounded-full blur-2xl"></div>

        <!-- Cabeçalho / Logo -->
        <div class="text-center mb-6">
          <img src="/images/logo.svg" alt="Logo Quem Sou Eu" class="w-24 h-24 mx-auto mb-3 drop-shadow-2xl animate-pulse-subtle" />
          <h1 class="text-3xl md:text-4xl font-black tracking-tight text-white m-0">QUEM SOU EU?</h1>
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

          <!-- Seleção de Avatar -->
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
        el.className = el.className.replace("bg-cyan-500 ring-2 ring-cyan-300 scale-110 shadow-lg shadow-cyan-500/30", "bg-slate-800/80 hover:bg-slate-700");
      });
      btn.className = "avatar-option flex-none w-11 h-11 text-2xl rounded-2xl flex items-center justify-center transition bg-cyan-500 ring-2 ring-cyan-300 scale-110 shadow-lg shadow-cyan-500/30";
      state.playerAvatar = btn.dataset.avatar;
    });
  });

  // Criar Sala
  document.getElementById("btn-create-room")?.addEventListener("click", () => {
    const nameInput = document.getElementById("player-name-input");
    const name = nameInput.value.trim() || "Host";
    saveLocalPlayer(name, state.playerAvatar);

    sound.ensureContext();
    state.socket.emit("create_room", { name, settings: {} }, (res) => {
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

  // Entrar na Sala
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

    state.socket.emit("join_room", { code, name }, (res) => {
      if (res && res.success) {
        state.roomCode = res.code;
        state.room = res.room;
        state.currentScreen = res.room.state === "playing" ? "game" : "lobby";
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
}

// ==========================================
// 2. TELA DE LOBBY (SALA DE ESPERA)
// ==========================================
function renderLobby(container) {
  const room = state.room;
  if (!room) return;

  const isHost = room.hostId === state.myId;
  const joinUrl = `${window.location.origin}/?room=${room.code}`;
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
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-12 gap-5">
        <!-- Coluna 1: Convite & QR Code (Mobile e PC) -->
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

  // Copiar Link
  document.getElementById("btn-copy-link")?.addEventListener("click", () => {
    const joinUrl = `${window.location.origin}/?room=${state.roomCode}`;
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
// 2.5 FASE DE SUGESTÃO DE PALAVRAS (NOVA MECÂNICA)
// ==========================================
function renderWordSuggestion(container) {
  const room = state.room;
  if (!room) return;

  const isHost = room.hostId === state.myId;
  const hasSubmitted = !!room.hasSubmittedMyWord;
  const submittedCount = room.submittedCount || 0;
  const totalPlayers = room.totalPlayers || room.players.length;

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
              <span class="text-xs font-black text-cyan-300">${submittedCount} / ${totalPlayers} Prontos</span>
            </div>

            <!-- Lista de Jogadores -->
            <div class="space-y-2 overflow-y-auto max-h-48 pr-1">
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
                  title="Inicia a partida preenchendo automaticamente quem não enviou"
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
    const form = document.getElementById("form-submit-word");
    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      const wordInput = document.getElementById("input-suggest-word");
      const catInput = document.getElementById("input-suggest-category");
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
          showToast("Palavra enviada com sucesso!", "success");
        }
      });
    });
  }

  document.getElementById("btn-force-distribute")?.addEventListener("click", () => {
    if (confirm("Deseja iniciar a rodada agora? (Quem não enviou receberá uma palavra automática do jogo)")) {
      sound.ensureContext();
      state.socket.emit("game:distribute", { code: state.roomCode });
    }
  });
}

// ==========================================
// 3. TELA DE JOGO (DINÂMICA GARTIC + TESTA)
// ==========================================
function renderGame(container) {
  const room = state.room;
  if (!room) return;

  const isMyTurn = room.activePlayerId === state.myId;
  const activePlayer = room.players.find((p) => p.id === room.activePlayerId);
  const myPlayer = room.players.find((p) => p.id === state.myId);
  const turnSeconds = room.turnSecondsRemaining ?? room.settings?.turnTime ?? 60;
  const totalSeconds = room.settings?.turnTime || 60;
  const timePercent = Math.max(0, Math.min(100, (turnSeconds / totalSeconds) * 100));

  container.innerHTML = `
    <div class="min-h-screen flex flex-col p-2 md:p-4 max-w-7xl mx-auto">
      <!-- Barra Superior: Info da Rodada e Cronômetro -->
      <header class="glass-panel px-4 py-2.5 rounded-2xl mb-3 flex items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <span class="px-2.5 py-1 rounded-xl bg-cyan-500/20 text-cyan-300 font-black text-xs md:text-sm border border-cyan-500/30">
            Rodada ${room.currentRound} de ${room.settings?.totalRounds || 3}
          </span>
          <span class="text-xs text-slate-400 font-bold hidden sm:inline">Sala: ${room.code}</span>
        </div>

        <!-- Cronômetro Central -->
        <div class="flex-1 max-w-md mx-2 flex flex-col items-center">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-xs font-bold text-slate-300">Tempo Restante:</span>
            <span id="timer-seconds-display" class="font-black text-sm md:text-base ${turnSeconds <= 10 ? 'text-rose-400 animate-pulse' : 'text-cyan-300'}">
              ${turnSeconds}s
            </span>
          </div>
          <div class="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden border border-slate-700/60">
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

      <!-- Layout Principal estilo Gartic: 3 Colunas no PC, Empilhado no Celular -->
      <div class="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3 min-h-0">
        <!-- Coluna Esquerda: Placar e Jogadores Conectados -->
        <div class="lg:col-span-3 glass-panel p-3.5 rounded-3xl flex flex-col max-h-[350px] lg:max-h-full overflow-hidden">
          <h3 class="text-xs font-black uppercase text-slate-400 tracking-wider mb-2 flex items-center justify-between">
            <span>Classificação</span>
            <span>🏆 Pontos</span>
          </h3>

          <div class="flex-1 overflow-y-auto space-y-2 pr-1">
            ${[...room.players]
              .sort((a, b) => b.score - a.score)
              .map((p, idx) => {
                const isActive = p.id === room.activePlayerId;
                const isMe = p.id === state.myId;
                return `
                  <div class="flex items-center justify-between p-2.5 rounded-2xl transition border ${
                    isActive
                      ? 'bg-cyan-950/40 border-cyan-400 shadow-md shadow-cyan-500/20 active-turn-ring'
                      : isMe
                      ? 'bg-slate-800/80 border-slate-600'
                      : 'bg-slate-900/50 border-slate-800'
                  }">
                    <div class="flex items-center gap-2 overflow-hidden">
                      <span class="text-xs font-black text-slate-400 w-4">${idx + 1}º</span>
                      <span class="text-xl">${escapeHtml(p.avatar)}</span>
                      <div class="overflow-hidden">
                        <p class="text-xs md:text-sm font-bold text-white truncate m-0 flex items-center gap-1">
                          ${escapeHtml(p.name)}
                          ${isMe ? '<span class="text-[9px] text-cyan-300">(Você)</span>' : ''}
                        </p>
                        ${isActive ? '<span class="text-[10px] font-black text-cyan-400">VEZ DELE(A) 🎯</span>' : ''}
                      </div>
                    </div>
                    <span class="font-black text-sm text-amber-300 ml-2">${p.score}</span>
                  </div>
                `;
              })
              .join("")}
          </div>
        </div>

        <!-- Coluna Central: A MESA E A TESTA DO JOGADOR DA VEZ -->
        <div class="lg:col-span-5 flex flex-col gap-3 min-h-0">
          <!-- O CARTÃO NA TESTA -->
          <div class="glass-panel p-5 rounded-3xl flex-1 flex flex-col items-center justify-center text-center relative overflow-hidden">
            ${isMyTurn ? `
              <!-- VOCÊ É O JOGADOR DA VEZ: VOCÊ NÃO VÊ A SUA PALAVRA! -->
              <div class="w-full flex flex-col items-center card-my-forehead p-6 rounded-3xl bg-gradient-to-b from-amber-500/20 to-slate-900/60 border-2 border-amber-400/60">
                <div class="text-4xl md:text-5xl mb-2 animate-bounce">❓</div>
                <span class="px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 text-xs font-black uppercase tracking-wider mb-3 border border-amber-500/40">
                  SUA PALAVRA NA TESTA
                </span>
                <h2 class="text-2xl md:text-4xl font-black text-white m-0 tracking-wide">
                  QUEM SOU EU?
                </h2>
                <p class="text-xs md:text-sm font-bold text-cyan-300 mt-2">
                  🌟 Categoria: ${escapeHtml(myPlayer?.currentWord?.categoriaNome || "Geral")}
                </p>
                <p class="text-xs text-slate-300 mt-2 max-w-sm">
                  Faça perguntas aos outros jogadores pelo chat para descobrir sua identidade antes que o tempo acabe!
                </p>
              </div>

              <!-- Botão para passar a vez se travar -->
              <div class="mt-3 w-full flex justify-end">
                <button id="btn-skip-turn" class="text-xs text-slate-400 hover:text-rose-400 font-bold px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 transition">
                  ⏭️ Desistir / Passar a Vez
                </button>
              </div>
            ` : `
              <!-- OUTRO JOGADOR É A VEZ: VOCÊ VÊ A PALAVRA DELE NA TESTA! -->
              <div class="w-full flex flex-col items-center p-6 rounded-3xl bg-gradient-to-b from-cyan-500/20 to-slate-900/60 border-2 border-cyan-400/50">
                <div class="text-3xl md:text-4xl mb-1">${escapeHtml(activePlayer?.avatar || "👤")}</div>
                <span class="text-xs font-bold text-slate-300 mb-1">
                  É a vez de <strong class="text-cyan-300 font-black">${escapeHtml(activePlayer?.name || "Jogador")}</strong>
                </span>
                <span class="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">
                  Categoria: ${escapeHtml(activePlayer?.currentWord?.categoriaNome || "Geral")}
                </span>

                <!-- PALAVRA REVELADA NA TESTA DELE -->
                <div class="bg-white/95 text-slate-900 px-6 py-4 rounded-2xl shadow-2xl w-full max-w-md transform hover:scale-102 transition">
                  <span class="block text-[10px] font-black uppercase text-slate-500 tracking-wider">A Palavra Secreta dele(a) é:</span>
                  <h2 class="text-2xl md:text-3xl font-black m-0 text-slate-900 tracking-tight break-words">
                    ${escapeHtml(activePlayer?.currentWord?.palavra || "Sorteando...")}
                  </h2>
                </div>

                <p class="text-xs text-slate-300 mt-3 max-w-sm">
                  Responda às perguntas dele(a) no chat dizendo apenas SIM ou NÃO! Não dê spoilers diretos!
                </p>
              </div>

              <!-- BOTÕES DE RESPOSTA RÁPIDA (1 TOQUE NO CELULAR OU PC) -->
              <div class="w-full mt-3 grid grid-cols-3 gap-2">
                <button
                  type="button"
                  data-quick-reaction="yes"
                  class="py-3 px-2 rounded-2xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 font-black text-xs md:text-sm active:scale-95 transition flex items-center justify-center gap-1 shadow-md shadow-emerald-950/40"
                >
                  👍 SIM
                </button>
                <button
                  type="button"
                  data-quick-reaction="no"
                  class="py-3 px-2 rounded-2xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 font-black text-xs md:text-sm active:scale-95 transition flex items-center justify-center gap-1 shadow-md shadow-rose-950/40"
                >
                  👎 NÃO
                </button>
                <button
                  type="button"
                  data-quick-reaction="maybe"
                  class="py-3 px-2 rounded-2xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-black text-xs md:text-sm active:scale-95 transition flex items-center justify-center gap-1 shadow-md shadow-amber-950/40"
                >
                  🤔 TALVEZ
                </button>
              </div>
            `}
          </div>
        </div>

        <!-- Coluna Direita: O CHAT DE PALPITES ESTILO GARTIC -->
        <div class="lg:col-span-4 glass-panel p-3.5 rounded-3xl flex flex-col h-[400px] lg:h-full overflow-hidden">
          <div class="flex items-center justify-between pb-2 mb-2 border-b border-slate-700/50">
            <h3 class="text-xs font-black uppercase text-slate-300 tracking-wider m-0 flex items-center gap-1.5">
              <span>💬</span> Chat & Palpites
            </h3>
            <span class="text-[10px] text-cyan-400 font-bold">Validação Automática ⚡</span>
          </div>

          <!-- Feed de Mensagens com Rolagem Automática -->
          <div id="chat-messages-container" class="flex-1 overflow-y-auto space-y-1.5 pr-1">
            <!-- Mensagens são adicionadas dinamicamente aqui -->
          </div>

          <!-- Caixa de Entrada de Texto -->
          <form id="chat-form" class="mt-2 flex gap-1.5" onsubmit="return false;">
            <input
              type="text"
              id="chat-input"
              maxlength="100"
              autocomplete="off"
              placeholder="${isMyTurn ? 'Digite sua pergunta ou palpite...' : 'Envie uma dica ou converse...'}"
              class="glass-input flex-1 px-3 py-2.5 rounded-xl text-white text-sm font-medium focus:ring-1 focus:ring-cyan-400"
            />
            <button
              type="submit"
              id="btn-send-chat"
              class="px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-black text-sm active:scale-95 transition flex items-center justify-center shadow-md shadow-cyan-500/20"
            >
              ${isMyTurn ? "Palpitar 🎯" : "Enviar 💬"}
            </button>
          </form>
        </div>
      </div>
    </div>
  `;

  bindGameEvents(isMyTurn);
  populateInitialChat();
}

function bindGameEvents(isMyTurn) {
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

  // Passar a vez
  document.getElementById("btn-skip-turn")?.addEventListener("click", () => {
    if (confirm("Tem certeza que deseja passar a sua vez?")) {
      state.socket.emit("skip_turn", { code: state.roomCode });
    }
  });

  // Reações Rápidas (SIM, NÃO, TALVEZ)
  document.querySelectorAll("[data-quick-reaction]").forEach((btn) => {
    btn.addEventListener("click", () => {
      sendQuickReaction(btn.dataset.quickReaction);
    });
  });

  // Envio de Mensagem / Palpite no Chat
  const chatForm = document.getElementById("chat-form");
  chatForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    sendChatMessage();
  });
}

function populateInitialChat() {
  const container = document.getElementById("chat-messages-container");
  if (!container || !state.room?.chatMessages) return;

  container.innerHTML = "";
  // Renderiza histórico
  state.chatMessages.forEach((msg) => {
    const isMe = msg.senderId === state.myId;
    const msgEl = document.createElement("div");

    if (msg.type === "system") {
      let bgStyle = "bg-slate-800/80 border-slate-700 text-slate-300";
      if (msg.subtype === "correct_guess") {
        bgStyle = "bg-amber-500/20 border-amber-500/50 text-amber-300 font-bold shadow-lg shadow-amber-500/10";
      } else if (msg.subtype === "timeout" || msg.subtype === "skip") {
        bgStyle = "bg-rose-500/20 border-rose-500/40 text-rose-300 font-medium";
      } else if (msg.subtype === "round_end" || msg.subtype === "game_over") {
        bgStyle = "bg-cyan-500/20 border-cyan-500/40 text-cyan-200 font-bold";
      }
      msgEl.className = `p-2.5 my-1 rounded-xl text-xs md:text-sm text-center border ${bgStyle}`;
      msgEl.innerHTML = `<span>${escapeHtml(msg.text)}</span>`;
    } else if (msg.type === "quick_reaction") {
      let colorClass = "bg-emerald-500/20 text-emerald-400 border-emerald-500/40";
      if (msg.reactionType === "no") colorClass = "bg-rose-500/20 text-rose-400 border-rose-500/40";
      if (msg.reactionType === "maybe") colorClass = "bg-amber-500/20 text-amber-400 border-amber-500/40";

      msgEl.className = `flex items-center gap-2 p-2 my-1 rounded-xl text-sm border ${colorClass} ${isMe ? 'ml-auto max-w-[85%]' : 'mr-auto max-w-[85%]'}`;
      msgEl.innerHTML = `
        <span class="text-base">${escapeHtml(msg.avatar || "👤")}</span>
        <div class="flex flex-col">
          <span class="text-[10px] text-slate-400 font-bold">${escapeHtml(msg.senderName)}</span>
          <span class="font-black text-sm tracking-wide">${escapeHtml(msg.text)}</span>
        </div>
      `;
    } else if (msg.type === "guess") {
      msgEl.className = `flex flex-col p-2.5 my-1.5 rounded-xl border border-cyan-500/40 bg-cyan-950/40 ${isMe ? 'ml-auto max-w-[90%]' : 'mr-auto max-w-[90%]'}`;
      msgEl.innerHTML = `
        <div class="flex items-center gap-1.5 mb-0.5">
          <span>${escapeHtml(msg.avatar || "🎯")}</span>
          <span class="text-xs font-black text-cyan-300">${escapeHtml(msg.senderName)} (Palpite)</span>
        </div>
        <p class="text-sm font-semibold text-white break-words m-0">${escapeHtml(msg.text)}</p>
      `;
    } else {
      msgEl.className = `flex flex-col p-2 my-1 rounded-xl bg-slate-800/60 border border-slate-700/50 ${isMe ? 'ml-auto max-w-[85%]' : 'mr-auto max-w-[85%]'}`;
      msgEl.innerHTML = `
        <div class="flex items-center gap-1.5 mb-0.5">
          <span class="text-xs">${escapeHtml(msg.avatar || "👤")}</span>
          <span class="text-[11px] font-bold ${isMe ? 'text-cyan-400' : 'text-slate-400'}">${escapeHtml(msg.senderName)}</span>
        </div>
        <p class="text-sm text-slate-200 break-words m-0">${escapeHtml(msg.text)}</p>
      `;
    }

    container.appendChild(msgEl);
  });
  container.scrollTop = container.scrollHeight;
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
