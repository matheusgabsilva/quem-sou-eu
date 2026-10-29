import { state } from "./state.js";
import { sound } from "./audio.js";

// Envia mensagem ou pergunta/palpite via Socket
export function sendChatMessage() {
  const input = document.getElementById("chat-input");
  if (!input) return;

  const text = input.value.trim();
  if (!text || !state.socket || !state.roomCode) return;

  sound.ensureContext();

  state.socket.emit("chat_message", {
    code: state.roomCode,
    text
  }, (res) => {
    if (res && res.result && res.result.correct) {
      sound.playSuccess();
    }
  });

  input.value = "";
  input.focus();
}

// Envia palpite único do jogador ativo
export function sendPlayerGuess(guessText) {
  const text = (guessText || "").trim();
  if (!text || !state.socket || !state.roomCode) return;

  sound.ensureContext();

  state.socket.emit("turn:guess", {
    code: state.roomCode,
    guess: text
  }, (res) => {
    if (res && res.correct) {
      sound.playSuccess();
    }
  });
}

// Envia reação rápida (SIM / NÃO / TALVEZ) sem reproduzir sons incômodos
export function sendQuickReaction(reactionType) {
  if (!state.socket || !state.roomCode) return;
  // Intencionalmente NÃO toca nenhum som irritante ao responder
  state.socket.emit("quick_reaction", {
    code: state.roomCode,
    reaction: reactionType
  });
}

// Renderiza elemento HTML de uma mensagem individual
export function renderMessageElement(msg) {
  const isMe = msg.senderId === state.myId;
  const msgEl = document.createElement("div");

  if (msg.type === "system") {
    let bgStyle = "bg-slate-800/80 border-slate-700 text-slate-300";
    if (msg.subtype === "correct_guess") {
      bgStyle = "bg-amber-500/20 border-amber-500/50 text-amber-300 font-bold shadow-lg shadow-amber-500/10";
    } else if (msg.subtype === "wrong_guess" || msg.subtype === "timeout" || msg.subtype === "skip") {
      bgStyle = "bg-rose-500/20 border-rose-500/40 text-rose-300 font-medium";
    } else if (msg.subtype === "round_end" || msg.subtype === "game_over") {
      bgStyle = "bg-cyan-500/20 border-cyan-500/40 text-cyan-200 font-bold";
    }

    msgEl.className = `p-2 my-1 rounded-xl text-xs md:text-sm text-center border ${bgStyle} animate-fade-in`;
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
  } else if (msg.type === "question") {
    msgEl.className = `flex flex-col p-2.5 my-1.5 rounded-xl border border-amber-500/50 bg-amber-950/30 ${isMe ? 'ml-auto max-w-[90%]' : 'mr-auto max-w-[90%]'}`;
    msgEl.innerHTML = `
      <div class="flex items-center gap-1.5 mb-0.5">
        <span>❓</span>
        <span class="text-xs font-black text-amber-300">${escapeHtml(msg.senderName)} (Pergunta da Vez)</span>
      </div>
      <p class="text-sm font-bold text-white break-words m-0">${escapeHtml(msg.text)}</p>
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
  } else if (msg.type === "censored") {
    msgEl.className = `flex flex-col p-2 my-1 rounded-xl bg-slate-900 border border-rose-500/30 text-rose-300/80 italic text-xs ${isMe ? 'ml-auto max-w-[85%]' : 'mr-auto max-w-[85%]'}`;
    msgEl.innerHTML = `
      <div class="flex items-center gap-1.5 mb-0.5">
        <span class="text-xs">🛡️</span>
        <span class="text-[10px] font-bold text-slate-400">${escapeHtml(msg.senderName)}</span>
      </div>
      <p class="m-0">${escapeHtml(msg.text)}</p>
    `;
  } else {
    // Conversa normal
    msgEl.className = `flex flex-col p-2 my-1 rounded-xl bg-slate-800/60 border border-slate-700/50 ${isMe ? 'ml-auto max-w-[85%]' : 'mr-auto max-w-[85%]'}`;
    msgEl.innerHTML = `
      <div class="flex items-center gap-1.5 mb-0.5">
        <span class="text-xs">${escapeHtml(msg.avatar || "👤")}</span>
        <span class="text-[11px] font-bold ${isMe ? 'text-cyan-400' : 'text-slate-400'}">${escapeHtml(msg.senderName)}</span>
      </div>
      <p class="text-sm text-slate-200 break-words m-0">${escapeHtml(msg.text)}</p>
    `;
  }

  return msgEl;
}

// Adiciona uma mensagem ao feed do chat na tela com rolagem interna inteligente
export function appendChatMessage(msg) {
  state.chatMessages.push(msg);
  const container = document.getElementById("chat-messages-container");
  if (!container) return;

  const isMe = msg.senderId === state.myId;
  const isScrolledToBottom = container.scrollHeight - container.clientHeight <= container.scrollTop + 60;

  const msgEl = renderMessageElement(msg);
  container.appendChild(msgEl);

  // Rola automaticamente para baixo apenas se já estava no fim ou se a mensagem é do próprio usuário/sistema
  if (isScrolledToBottom || isMe || msg.type === "system" || msg.type === "question") {
    container.scrollTop = container.scrollHeight;
  }
}

export function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
