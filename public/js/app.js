import { state } from "./state.js";
import { initSocket } from "./socket.js";
import { renderCurrentScreen } from "./ui-render.js";

async function initApp() {
  try {
    // Carrega informações do servidor e categorias
    const response = await fetch("/api/info");
    if (response.ok) {
      const data = await response.json();
      state.availableCategories = data.categories || [];
    }
  } catch (err) {
    console.warn("Aviso ao buscar /api/info:", err);
  }

  // Inicializa a conexão Socket.io em tempo real
  initSocket();

  // Renderiza a tela inicial
  renderCurrentScreen();
}

window.addEventListener("DOMContentLoaded", initApp);
