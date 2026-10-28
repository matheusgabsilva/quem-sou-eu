// Estado reativo da aplicação no cliente
export const state = {
  socket: null,
  myId: null,
  currentScreen: "home", // "home" | "lobby" | "game" | "podium"
  
  // Dados do Jogador Local
  playerName: localStorage.getItem("qse_name") || "",
  playerAvatar: localStorage.getItem("qse_avatar") || "🦊",
  
  // Dados da Sala Conectada
  roomCode: "",
  room: null, // snapshot seguro vindo do servidor
  
  // Categorias disponíveis no backend
  availableCategories: [],
  
  // Histórico de mensagens do chat nesta sessão
  chatMessages: [],
  
  // Status de som
  soundEnabled: localStorage.getItem("qse_sound") !== "false",
  
  // Flag para avisos temporários
  activeFeedback: null
};

export function saveLocalPlayer(name, avatar) {
  state.playerName = name;
  state.playerAvatar = avatar;
  localStorage.setItem("qse_name", name);
  localStorage.setItem("qse_avatar", avatar);
}

export function toggleSound() {
  state.soundEnabled = !state.soundEnabled;
  localStorage.setItem("qse_sound", state.soundEnabled ? "true" : "false");
  return state.soundEnabled;
}
