export const safeStorage = {
  getItem: (key) => {
    try {
      return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(key, value);
      }
    } catch {
      // Ignora em contextos com armazenamento restrito
    }
  }
};

// Mapeia o estado da sala no servidor para a tela correspondente na interface
export function getScreenForRoomState(roomState) {
  if (roomState === "word_suggestion") return "word_suggestion";
  if (roomState === "playing" || roomState === "turn_celebration") return "game";
  if (roomState === "game_over") return "podium";
  return "lobby";
}

// Estado reativo da aplicação no cliente
export const state = {
  socket: null,
  myId: null,
  currentScreen: "home", // "home" | "lobby" | "game" | "podium"
  
  // Dados do Jogador Local
  playerName: safeStorage.getItem("qse_name") || "",
  playerAvatar: safeStorage.getItem("qse_avatar") || "🦊",
  
  // Rascunho local de sugestão de palavra (preservado em atualizações de estado)
  wordDraft: { word: "", category: "" },
  
  // Dados da Sala Conectada
  roomCode: "",
  room: null, // snapshot seguro vindo do servidor
  
  // Categorias disponíveis no backend
  availableCategories: [],
  
  // Histórico de mensagens do chat nesta sessão
  chatMessages: [],
  
  // Status de som
  soundEnabled: safeStorage.getItem("qse_sound") !== "false",
  
  // Flag para avisos temporários
  activeFeedback: null
};

export function saveLocalPlayer(name, avatar) {
  state.playerName = name;
  state.playerAvatar = avatar;
  safeStorage.setItem("qse_name", name);
  safeStorage.setItem("qse_avatar", avatar);
}

export function toggleSound() {
  state.soundEnabled = !state.soundEnabled;
  safeStorage.setItem("qse_sound", state.soundEnabled ? "true" : "false");
  return state.soundEnabled;
}
