import { state } from "./state.js";
import { initSocket } from "./socket.js";
import { renderCurrentScreen } from "./ui-render.js";

async function initApp() {
  // 1. Renderiza a tela inicial imediatamente para nunca haver tela preta/congelada
  renderCurrentScreen();

  // 2. Busca informações de categorias de forma assíncrona
  try {
    const response = await fetch("/api/info");
    if (response.ok) {
      const data = await response.json();
      state.availableCategories = data.categories || [];
    }
  } catch (err) {
    console.warn("Aviso ao buscar /api/info (servidor pode estar em outro host):", err);
  }

  // 3. Inicializa conexão WebSocket de forma segura
  try {
    initSocket();
  } catch (err) {
    console.error("Erro ao inicializar Socket.io:", err);
  }
}

window.addEventListener("DOMContentLoaded", initApp);
