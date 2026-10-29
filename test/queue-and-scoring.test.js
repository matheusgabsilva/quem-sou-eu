import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mock } from "node:test";
import { Server } from "socket.io";
import { io as createSocketClient } from "socket.io-client";
import { GameManager } from "../lib/game-manager.js";
import { setupSocketHandlers } from "../lib/socket-handler.js";
import { parseQuickResponseText, evaluateGuess } from "../lib/server-utils.js";
import {
  OFFICIAL_DOMAIN,
  getShareUrl,
  isPrivateOrLocalHost,
  BOARD_LAYOUT_SPANS,
  TUTORIAL_RULES,
  TUTORIAL_FOCUSABLE_IDS,
  getTutorialFocusTarget,
  openTutorialModal,
  closeTutorialModal,
  renderCurrentScreen
} from "../public/js/ui-render.js";
import { shouldFollowChatScroll, calculateRestoredScrollPosition, CHAT_SCROLL_THRESHOLD, escapeHtml } from "../public/js/chat.js";
import { state, getScreenForRoomState, safeStorage } from "../public/js/state.js";

function createMockIo() {
  const events = [];
  const roomEmitters = new Map();
  const socketsMap = new Map();

  function getRoomEmitter(roomCode) {
    if (!roomEmitters.has(roomCode)) {
      roomEmitters.set(roomCode, {
        emit: (event, data) => {
          events.push({ room: roomCode, event, data });
        }
      });
    }
    return roomEmitters.get(roomCode);
  }

  function getOrCreateSocket(socketId) {
    if (!socketsMap.has(socketId)) {
      socketsMap.set(socketId, {
        id: socketId,
        emit: (event, data) => {
          events.push({ socketId, event, data });
        }
      });
    }
    return socketsMap.get(socketId);
  }

  return {
    events,
    sockets: {
      sockets: {
        get: (id) => getOrCreateSocket(id)
      }
    },
    to: (target) => getRoomEmitter(target),
    emit: (event, data) => {
      events.push({ room: "global", event, data });
    },
    clearEvents: () => {
      events.length = 0;
    }
  };
}

// Cria uma sala em andamento (state "playing") com N jogadores e o turno do primeiro jogador iniciado.
// Usa o fluxo real do GameManager (startTurn) para que turnSeq, timers e broadcasts sejam os reais.
function createPlayingRoom(playerCount = 3, settings = {}) {
  const io = createMockIo();
  const gm = new GameManager(io);
  const roster = [
    ["p1", "Alice", "🦁", "Girafa"],
    ["p2", "Bob", "🦊", "Piano"],
    ["p3", "Carol", "🐼", "Tartaruga"],
    ["p4", "Dan", "🐸", "Sorvete"]
  ].slice(0, playerCount);

  const room = gm.createRoom("p1", "Alice", settings, "🦁");
  for (const [id, name, avatar] of roster.slice(1)) {
    gm.joinRoom(room.code, id, name, avatar);
  }
  room.state = "playing";
  room.unresolvedQueue = roster.map(([id]) => id);
  for (const player of room.players) {
    const entry = roster.find(([id]) => id === player.id);
    player.currentWord = { palavra: entry[3], categoriaNome: "Teste" };
  }
  gm.startTurn(room);
  return { io, gm, room, code: room.code };
}

// O jogador ativo faz a pergunta e outro jogador responde (libera palpite/passagem)
function askAndAnswer(gm, room, answererId) {
  gm.handleChatMessage(room.code, room.activePlayerId, "Sou algo?");
  gm.handleQuickReaction(room.code, answererId, "yes");
}

// Conta chamadas a startTurn e criações de timers (setInterval / setTimeout) sem esperar tempo real.
// Deve ser usado depois de mock.timers.enable() e restaurado (restore) antes de mock.timers.reset().
function instrumentTurns(gm) {
  const counts = { startTurn: 0, setInterval: 0, setTimeout: 0 };
  const originalStartTurn = gm.startTurn;
  const originalSetInterval = globalThis.setInterval;
  const originalSetTimeout = globalThis.setTimeout;

  gm.startTurn = function (room) {
    counts.startTurn++;
    return originalStartTurn.call(gm, room);
  };
  globalThis.setInterval = (...args) => {
    counts.setInterval++;
    return originalSetInterval(...args);
  };
  globalThis.setTimeout = (...args) => {
    counts.setTimeout++;
    return originalSetTimeout(...args);
  };

  return {
    counts,
    reset() {
      counts.startTurn = 0;
      counts.setInterval = 0;
      counts.setTimeout = 0;
    },
    restore() {
      gm.startTurn = originalStartTurn;
      globalThis.setInterval = originalSetInterval;
      globalThis.setTimeout = originalSetTimeout;
    }
  };
}

function countStateUpdates(io) {
  return io.events.filter((e) => e.event === "room_state_update").length;
}

function countTurnAnnouncements(io) {
  return io.events.filter(
    (e) => e.event === "new_chat_message" && e.data?.type === "system" && String(e.data.text).includes("É a vez de")
  ).length;
}

async function createRealtimeSocketServer() {
  const httpServer = createServer();
  const io = new Server(httpServer, { cors: { origin: "*" } });
  const gameManager = setupSocketHandlers(io);

  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();

  return {
    gameManager,
    connect() {
      const client = createSocketClient(`http://127.0.0.1:${address.port}`, {
        transports: ["websocket"],
        forceNew: true
      });
      return new Promise((resolve, reject) => {
        client.once("connect", () => resolve(client));
        client.once("connect_error", reject);
      });
    },
    async close() {
      io.close();
      await new Promise((resolve) => httpServer.close(resolve));
    }
  };
}

function emitWithAck(client, eventName, ...args) {
  return new Promise((resolve, reject) => {
    client.timeout(1000).emit(eventName, ...args, (error, response) => {
      if (error) reject(error);
      else resolve(response);
    });
  });
}

// Executa um teste assíncrono com relógio falso (node:test mock.timers): nada espera tempo real.
async function withFakeTimers(fn) {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  try {
    await fn();
  } finally {
    mock.timers.reset();
  }
}

function setupMockDom() {
  const elements = new Map();
  const listeners = new Map();
  const idsIn = (html) => [...String(html).matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]);

  class MockElement {
    constructor(tagName) {
      this.tagName = tagName;
      this.attributes = {};
      this._innerHTML = "";
      this.parentNode = null;
      this.children = [];
      this.eventListeners = new Map();
      this.id = "";
      this.className = "";
      this.isFocused = false;
    }

    // Um elemento está conectado enquanto for o registrado para o seu id no "documento"
    get isConnected() {
      return !!this.id && elements.get(this.id) === this;
    }

    setAttribute(name, value) {
      this.attributes[name] = value;
    }

    getAttribute(name) {
      return this.attributes[name];
    }

    set innerHTML(val) {
      this._innerHTML = val;
      // Cada atribuição de innerHTML "recria" os filhos com id (novos objetos, sem listeners antigos)
      for (const id of idsIn(val)) {
        const child = new MockElement("div");
        child.id = id;
        elements.set(id, child);
      }
    }

    get innerHTML() {
      return this._innerHTML;
    }

    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      if (child.id) elements.set(child.id, child);
      return child;
    }

    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) this.children.splice(idx, 1);
      child.parentNode = null;
      if (child.id) elements.delete(child.id);
      for (const id of idsIn(child._innerHTML)) elements.delete(id);
      return child;
    }

    addEventListener(event, fn) {
      if (!this.eventListeners.has(event)) {
        this.eventListeners.set(event, []);
      }
      this.eventListeners.get(event).push(fn);
    }

    dispatch(event, data = {}) {
      const handlers = this.eventListeners.get(event) || [];
      for (const h of [...handlers]) h({ target: this, currentTarget: this, ...data });
    }

    focus() {
      this.isFocused = true;
      if (globalThis.document) globalThis.document.activeElement = this;
    }
  }

  const body = new MockElement("body");
  body.id = "body";
  elements.set("body", body);

  globalThis.document = {
    body,
    activeElement: body,
    createElement: (tag) => new MockElement(tag),
    getElementById: (id) => elements.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => []
  };

  globalThis.window = {
    location: { origin: "https://quemsou.online", hostname: "quemsou.online", search: "" },
    addEventListener: (event, fn) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },
    removeEventListener: (event, fn) => {
      if (listeners.has(event)) {
        const arr = listeners.get(event);
        const idx = arr.indexOf(fn);
        if (idx !== -1) arr.splice(idx, 1);
      }
    },
    // Dispara um keydown e devolve o evento (permite checar preventDefault)
    dispatchKeydown: (key, extra = {}) => {
      const event = {
        key,
        shiftKey: false,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        ...extra
      };
      for (const h of [...(listeners.get("keydown") || [])]) h(event);
      return event;
    },
    keydownListenerCount: () => (listeners.get("keydown") || []).length
  };

  return {
    // Registra um elemento raiz (ex.: <div id="app">) para as telas renderizarem nele
    registerElement: (id) => {
      const el = new MockElement("div");
      el.id = id;
      elements.set(id, el);
      return el;
    },
    cleanup: () => {
      delete globalThis.document;
      delete globalThis.window;
    }
  };
}

async function runTests() {
  console.log("==================================================");
  console.log(" INICIANDO BATERIA DE TESTES: FILA E PONTUAÇÃO    ");
  console.log("==================================================");

  let passedCount = 0;
  let totalCount = 0;

  function test(name, fn) {
    totalCount++;
    try {
      fn();
      console.log(`✅ [PASS] Teste ${totalCount}: ${name}`);
      passedCount++;
    } catch (err) {
      console.error(`❌ [FAIL] Teste ${totalCount}: ${name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }

  async function asyncTest(name, fn) {
    totalCount++;
    try {
      await fn();
      console.log(`✅ [PASS] Teste ${totalCount}: ${name}`);
      passedCount++;
    } catch (err) {
      console.error(`❌ [FAIL] Teste ${totalCount}: ${name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }

  // ----------------------------------------------------
  // TESTE 1: Fórmulas de pontuação base e bônus de tempo
  // ----------------------------------------------------
  test("Cálculo da pontuação base: Math.max(0, 110 - attempt * 10)", () => {
    const calcBase = (attempt) => Math.max(0, 110 - attempt * 10);

    assert.equal(calcBase(1), 100, "Tentativa 1 deve valer 100 base");
    assert.equal(calcBase(2), 90, "Tentativa 2 deve valer 90 base");
    assert.equal(calcBase(3), 80, "Tentativa 3 deve valer 80 base");
    assert.equal(calcBase(5), 60, "Tentativa 5 deve valer 60 base");
    assert.equal(calcBase(10), 10, "Tentativa 10 deve valer 10 base");
    assert.equal(calcBase(11), 0, "Tentativa 11 deve valer 0 base");
    assert.equal(calcBase(12), 0, "Tentativa 12 não pode ser negativa (min 0)");
    assert.equal(calcBase(25), 0, "Tentativas muito altas continuam em 0");
  });

  test("Cálculo do bônus de tempo com divisor fixo de 60s e clamp [0, 60]", () => {
    const calcBonus = (secondsRemaining) => {
      const tempoParaBonus = Math.min(60, Math.max(0, secondsRemaining));
      return Math.round(100 * (tempoParaBonus / 60));
    };

    assert.equal(calcBonus(60), 100, "60s restantes = 100 bônus");
    assert.equal(calcBonus(30), 50, "30s restantes = 50 bônus");
    assert.equal(calcBonus(45), 75, "45s restantes = 75 bônus");
    assert.equal(calcBonus(15), 25, "15s restantes = 25 bônus");
    assert.equal(calcBonus(0), 0, "0s restantes = 0 bônus");
    assert.equal(calcBonus(-5), 0, "Tempo negativo clampado em 0 = 0 bônus");
    assert.equal(calcBonus(90), 100, "90s (tempo configurado maior) clampado em 60s = 100 bônus");
    assert.equal(calcBonus(120), 100, "120s clampado em 60s = 100 bônus");
  });

  // ----------------------------------------------------
  // TESTE 2: Validação de resposta de espectador (parseQuickResponseText)
  // ----------------------------------------------------
  test("parseQuickResponseText reconhece afirmativo, negativo e talvez", () => {
    // Afirmativos
    assert.equal(parseQuickResponseText("sim"), "yes");
    assert.equal(parseQuickResponseText("SIM!"), "yes");
    assert.equal(parseQuickResponseText("Claro"), "yes");
    assert.equal(parseQuickResponseText("positivo"), "yes");
    assert.equal(parseQuickResponseText("aham"), "yes");
    assert.equal(parseQuickResponseText("uhum"), "yes");
    assert.equal(parseQuickResponseText("s"), "yes");

    // Negativos
    assert.equal(parseQuickResponseText("não"), "no");
    assert.equal(parseQuickResponseText("NAO"), "no");
    assert.equal(parseQuickResponseText("nunca"), "no");
    assert.equal(parseQuickResponseText("jamais"), "no");
    assert.equal(parseQuickResponseText("nope"), "no");
    assert.equal(parseQuickResponseText("n"), "no");

    // Talvez / Mais ou menos
    assert.equal(parseQuickResponseText("talvez"), "maybe");
    assert.equal(parseQuickResponseText("às vezes"), "maybe");
    assert.equal(parseQuickResponseText("pode ser"), "maybe");
    assert.equal(parseQuickResponseText("mais ou menos"), "maybe");
    assert.equal(parseQuickResponseText("depende"), "maybe");

    // Textos comuns que NÃO são respostas de SIM/NÃO/TALVEZ
    assert.equal(parseQuickResponseText("qualquer coisa"), null);
    assert.equal(parseQuickResponseText("olá galera"), null);
    assert.equal(parseQuickResponseText("kkkkkk"), null);
    assert.equal(parseQuickResponseText("eu acho que você é"), null);
    assert.equal(parseQuickResponseText(""), null);
    assert.equal(parseQuickResponseText(null), null);
  });

  // ----------------------------------------------------
  // TESTE 3: Inicialização da sala, fila de não resolvidos e distribuição
  // ----------------------------------------------------
  await asyncTest("Setup de sala com 3 jogadores e transição para playing", async () => {
    const io = createMockIo();
    const gm = new GameManager(io);

    const room = gm.createRoom("socket-p1", "Alice", { totalRounds: 2, turnTime: 60 }, "🦁");
    const code = room.code;
    gm.joinRoom(code, "socket-p2", "Bob", "🦊");
    gm.joinRoom(code, "socket-p3", "Carlos", "🐼");

    assert.equal(room.players.length, 3);

    // Inicia jogo -> vai para fase de sugestão de palavras
    await gm.startGame(code, "socket-p1");
    assert.equal(room.state, "word_suggestion");

    // Cada jogador submete uma palavra
    await gm.submitWord(code, "socket-p1", { word: "Batman", category: "Heróis" });
    await gm.submitWord(code, "socket-p2", { word: "Coringa", category: "Vilões" });
    const finalSubmit = await gm.submitWord(code, "socket-p3", { word: "Superman", category: "Heróis" });

    assert.equal(finalSubmit.state, "playing");
    assert.equal(room.state, "playing");

    // Fila de não resolvidos deve conter os 3 jogadores
    assert.equal(room.unresolvedQueue.length, 3);
    assert.equal(room.attemptNumber, 1);
    assert.equal(room.activePlayerId, room.unresolvedQueue[0]);

    // Regra de Ouro: Nenhum jogador recebe a própria palavra
    for (const p of room.players) {
      assert.notEqual(p.currentWord.palavra, p.submittedWord.palavra, `Jogador ${p.name} não pode receber a própria palavra`);
      assert.equal(p.hasGuessed, false);
    }
  });

  // ----------------------------------------------------
  // TESTE 4: Rotação da fila em erro e retenção da mesma palavra secreta
  // ----------------------------------------------------
  test("Palpite errado: jogador vai para o fim da fila, mantém mesma palavra e attemptNumber incrementa", () => {
    const io = createMockIo();
    const gm = new GameManager(io);

    const room = gm.createRoom("p1", "Alice", {}, "🦁");
    const code = room.code;
    gm.joinRoom(code, "p2", "Bob", "🦊");
    gm.joinRoom(code, "p3", "Carlos", "🐼");

    room.state = "playing";
    room.unresolvedQueue = ["p1", "p2", "p3"];
    room.attemptNumber = 1;

    const p1 = room.players.find((p) => p.id === "p1");
    const p2 = room.players.find((p) => p.id === "p2");
    const p3 = room.players.find((p) => p.id === "p3");

    p1.currentWord = { palavra: "Girafa", categoriaNome: "Animais" };
    p2.currentWord = { palavra: "Leão", categoriaNome: "Animais" };
    p3.currentWord = { palavra: "Tigre", categoriaNome: "Animais" };

    gm.startTurn(room);
    assert.equal(room.activePlayerId, "p1");
    assert.equal(room.turnPhase, "awaiting_question");

    // p1 faz pergunta
    gm.handleChatMessage(code, "p1", "Eu tenho quatro patas?");
    assert.equal(room.turnPhase, "awaiting_responses");

    // p2 responde "Sim"
    gm.handleChatMessage(code, "p2", "Sim!");
    assert.equal(room.turnPhase, "awaiting_guess_or_pass");

    // p1 faz palpite ERRADO
    const guessRes = gm.handlePlayerGuess(code, "p1", "Elefante");
    assert.equal(guessRes.correct, false);

    // O jogador deve ter sido movido do início para o fim da fila
    assert.deepEqual(room.unresolvedQueue, ["p2", "p3", "p1"], "p1 deve ter ido para o fim da fila");
    assert.equal(p1.currentWord.palavra, "Girafa", "Palavra secreta de p1 deve permanecer a mesma");
    assert.equal(p1.hasGuessed, false);
    assert.equal(room.attemptNumber, 2, "attemptNumber deve ter incrementado para 2");

    // A palavra NÃO pode ter sido revelada no resultado do turno
    assert.equal(room.turnResult.outcome, "wrong");
    assert.equal(room.turnResult.word, undefined, "Palavra não pode ser exposta no turnResult de erro");

    // Verifica que o estado para o próprio p1 mascara a palavra como '???'
    const clientStateP1 = gm.getRoomStateForPlayer(room, "p1");
    const p1InSanitized = clientStateP1.players.find((p) => p.id === "p1");
    assert.equal(p1InSanitized.currentWord.palavra, "???", "Jogador da vez não pode ver a própria palavra");
  });

  // ----------------------------------------------------
  // TESTE 5: Regras estritas de Passagem de Vez (skipTurn)
  // ----------------------------------------------------
  test("Host que não está na vez NÃO pode passar pelo jogador ativo", () => {
    const io = createMockIo();
    const gm = new GameManager(io);

    // p1 é o Host, p2 é outro jogador
    const room = gm.createRoom("p1", "Alice", {}, "🦁");
    const code = room.code;
    gm.joinRoom(code, "p2", "Bob", "🦊");

    room.state = "playing";
    room.unresolvedQueue = ["p2", "p1"]; // A vez é do p2!
    room.attemptNumber = 1;

    const p2 = room.players.find((p) => p.id === "p2");
    p2.currentWord = { palavra: "Mágico", categoriaNome: "Profissões" };

    gm.startTurn(room);
    assert.equal(room.activePlayerId, "p2", "O jogador da vez deve ser p2");

    io.clearEvents();

    // p1 (Host) tenta passar a vez de p2
    const hostSkipAttempt = gm.skipTurn(code, "p1");
    assert.equal(hostSkipAttempt, false, "Host NÃO deve poder passar a vez por outro jogador");
    assert.equal(room.turnEnded, false, "Turno deve permanecer ativo");
    assert.equal(room.activePlayerId, "p2", "Jogador ativo deve continuar sendo p2");
    assert.deepEqual(room.unresolvedQueue, ["p2", "p1"], "Fila não deve ser alterada");

    // Deve emitir aviso de feedback ao Host
    const feedback = io.events.find((e) => e.room === "p1" && e.event === "guess_feedback");
    assert.ok(feedback, "Host deve receber feedback de ação proibida");
    assert.equal(feedback.data.message, "Apenas o jogador da vez pode passar a vez.");
  });

  test("Jogador ativo NÃO pode passar a vez antes de fazer a pergunta", () => {
    const io = createMockIo();
    const gm = new GameManager(io);

    const room = gm.createRoom("p1", "Alice", {}, "🦁");
    const code = room.code;
    gm.joinRoom(code, "p2", "Bob", "🦊");

    room.state = "playing";
    room.unresolvedQueue = ["p1", "p2"];
    room.attemptNumber = 1;

    const p1 = room.players.find((p) => p.id === "p1");
    p1.currentWord = { palavra: "Astronauta", categoriaNome: "Profissões" };

    gm.startTurn(room);
    assert.equal(room.activePlayerId, "p1");
    assert.equal(room.turnPhase, "awaiting_question");

    io.clearEvents();

    // p1 tenta passar a vez sem perguntar
    const skipBeforeQuestion = gm.skipTurn(code, "p1");
    assert.equal(skipBeforeQuestion, false, "Jogador ativo não pode passar antes de formular pergunta");
    assert.equal(room.turnEnded, false, "Turno não pode ser encerrado");
    assert.equal(room.turnPhase, "awaiting_question");

    const feedback = io.events.find((e) => e.room === "p1" && e.event === "guess_feedback");
    assert.ok(feedback, "Jogador deve receber feedback de pergunta obrigatória");
    assert.equal(feedback.data.message, "Você deve formular sua pergunta e aguardar resposta antes de passar a vez.");
  });

  test("Passar a vez: jogador ativo passa após pergunta e resposta, vai para o fim da fila sem revelar palavra", () => {
    const io = createMockIo();
    const gm = new GameManager(io);

    const room = gm.createRoom("p1", "Alice", {}, "🦁");
    const code = room.code;
    gm.joinRoom(code, "p2", "Bob", "🦊");

    room.state = "playing";
    room.unresolvedQueue = ["p1", "p2"];
    room.attemptNumber = 2;

    const p1 = room.players.find((p) => p.id === "p1");
    p1.currentWord = { palavra: "Astronauta", categoriaNome: "Profissões" };

    gm.startTurn(room);
    assert.equal(room.activePlayerId, "p1");

    // p1 faz pergunta
    gm.handleChatMessage(code, "p1", "Eu viajo no espaço?");
    assert.equal(room.turnPhase, "awaiting_responses");

    // p2 responde via reação rápida
    gm.handleQuickReaction(code, "p2", "yes");
    assert.equal(room.turnPhase, "awaiting_guess_or_pass");

    // Agora sim p1 passa a vez com sucesso
    const skipSuccess = gm.skipTurn(code, "p1");
    assert.equal(skipSuccess, true);

    assert.deepEqual(room.unresolvedQueue, ["p2", "p1"]);
    assert.equal(p1.currentWord.palavra, "Astronauta");
    assert.equal(room.attemptNumber, 3);
    assert.equal(room.turnResult.outcome, "skipped");
  });

  // ----------------------------------------------------
  // TESTE 6: Regras estritas de Respostas Rápidas (SIM / NÃO / TALVEZ)
  // ----------------------------------------------------
  test("Resposta rápida antes da pergunta é rejeitada no servidor e NÃO entra no chat nem é transmitida", () => {
    const io = createMockIo();
    const gm = new GameManager(io);

    const room = gm.createRoom("p1", "Alice", {}, "🦁");
    const code = room.code;
    gm.joinRoom(code, "p2", "Bob", "🦊");

    room.state = "playing";
    room.unresolvedQueue = ["p1", "p2"];

    gm.startTurn(room);
    assert.equal(room.turnPhase, "awaiting_question");

    const chatCountBefore = room.chatMessages.length;
    io.clearEvents();

    // 1. Tenta resposta rápida via evento quick_reaction
    const reactionRes = gm.handleQuickReaction(code, "p2", "yes");
    assert.equal(reactionRes, false, "Resposta rápida antes da pergunta deve ser rejeitada");
    assert.equal(room.chatMessages.length, chatCountBefore, "Não deve ser adicionada ao histórico de chat");
    assert.equal(room.turnResponses.length, 0, "Não deve ser registrada como resposta de turno");

    // Garante que nenhum new_chat_message foi transmitido para a sala
    const emittedChat = io.events.find((e) => e.event === "new_chat_message");
    assert.equal(emittedChat, undefined, "Não pode transmitir mensagem de reação rejeitada à sala");

    // Garante que o feedback de aviso foi enviado ao remetente
    const feedback = io.events.find((e) => e.room === "p2" && e.event === "guess_feedback");
    assert.ok(feedback);
    assert.equal(feedback.data.message, "Aguarde o jogador da vez fazer a pergunta antes de responder.");

    // 2. Tenta resposta rápida via chat de texto ("Sim!")
    const chatReactionRes = gm.handleChatMessage(code, "p2", "Sim!");
    assert.equal(chatReactionRes.success, false, "Sim via chat antes da pergunta também deve ser rejeitado");
    assert.equal(room.chatMessages.length, chatCountBefore, "Não deve ser adicionado ao chat");
    assert.equal(room.turnPhase, "awaiting_question", "Fase deve continuar awaiting_question");
  });

  test("Respostas múltiplas depois da pergunta: primeira libera o palpite e demais continuam autorizados a responder", () => {
    const io = createMockIo();
    const gm = new GameManager(io);

    const room = gm.createRoom("p1", "Alice", {}, "🦁");
    const code = room.code;
    gm.joinRoom(code, "p2", "Bob", "🦊");
    gm.joinRoom(code, "p3", "Carlos", "🐼");

    room.state = "playing";
    room.unresolvedQueue = ["p1", "p2", "p3"];

    const p3 = room.players.find((p) => p.id === "p3");
    p3.hasGuessed = true; // Carlos já adivinhou a palavra dele anteriormente nesta rodada

    gm.startTurn(room);
    assert.equal(room.activePlayerId, "p1");

    // p1 faz a pergunta da vez
    gm.handleChatMessage(code, "p1", "Eu sou um cantor famoso?");
    assert.equal(room.turnPhase, "awaiting_responses");

    // 1ª resposta válida (Bob / p2): deve desbloquear a fase de palpite/passagem
    const res1 = gm.handleQuickReaction(code, "p2", "yes");
    assert.equal(res1, true);
    assert.equal(room.turnPhase, "awaiting_guess_or_pass", "Primeira resposta deve transicionar para awaiting_guess_or_pass");
    assert.equal(room.turnResponses.length, 1);

    // 2ª resposta válida (Carlos / p3 que já acertou): continua autorizado a responder!
    const res2 = gm.handleQuickReaction(code, "p3", "maybe");
    assert.equal(res2, true, "Jogador que já acertou continua autorizado a responder");
    assert.equal(room.turnPhase, "awaiting_guess_or_pass", "Fase permanece aberta para palpite sem quebrar");
    assert.equal(room.turnResponses.length, 2);

    // 3ª resposta válida (Bob / p2 complementa com NÃO): continua aceito
    const res3 = gm.handleQuickReaction(code, "p2", "no");
    assert.equal(res3, true, "Demais participantes continuam autorizados a responder");
    assert.equal(room.turnResponses.length, 3);
    assert.equal(room.turnPhase, "awaiting_guess_or_pass");
  });

  test("Resposta rápida após o encerramento do turno é rejeitada e NÃO entra no chat", () => {
    const io = createMockIo();
    const gm = new GameManager(io);

    const room = gm.createRoom("p1", "Alice", {}, "🦁");
    const code = room.code;
    gm.joinRoom(code, "p2", "Bob", "🦊");

    room.state = "playing";
    room.unresolvedQueue = ["p1", "p2"];

    const p1 = room.players.find((p) => p.id === "p1");
    p1.currentWord = { palavra: "Guitarra", categoriaNome: "Instrumentos" };

    gm.startTurn(room);
    gm.handleChatMessage(code, "p1", "Sou instrumento?");
    gm.handleQuickReaction(code, "p2", "yes");

    // p1 faz palpite correto -> turno encerra e vai para celebração
    gm.handlePlayerGuess(code, "p1", "Guitarra");
    assert.equal(room.turnEnded, true);
    assert.equal(room.state, "turn_celebration");

    const chatCountAtEnd = room.chatMessages.length;
    io.clearEvents();

    // p2 tenta enviar resposta rápida com o turno encerrado
    const lateReaction = gm.handleQuickReaction(code, "p2", "no");
    assert.equal(lateReaction, false, "Resposta rápida após encerramento do turno deve ser rejeitada");
    assert.equal(room.chatMessages.length, chatCountAtEnd, "Nenhuma mensagem adicionada ao chat");

    const emittedChat = io.events.find((e) => e.event === "new_chat_message");
    assert.equal(emittedChat, undefined, "Nenhuma mensagem transmitida");

    // p2 tenta enviar 'Sim!' no chat com turno encerrado
    const lateChat = gm.handleChatMessage(code, "p2", "Sim!");
    assert.equal(lateChat.success, false, "Chat com resposta rápida após encerramento deve ser rejeitado");
    assert.equal(room.chatMessages.length, chatCountAtEnd);
  });

  test("Tempo esgotado (handleTimeExpired): jogador vai para o fim da fila", () => {
    const io = createMockIo();
    const gm = new GameManager(io);

    const room = gm.createRoom("p1", "Alice", {}, "🦁");
    const code = room.code;
    gm.joinRoom(code, "p2", "Bob", "🦊");

    room.state = "playing";
    room.unresolvedQueue = ["p1", "p2"];
    room.attemptNumber = 3;

    gm.startTurn(room);
    assert.equal(room.activePlayerId, "p1");

    // Simula timeout
    gm.handleTimeExpired(room);

    assert.deepEqual(room.unresolvedQueue, ["p2", "p1"]);
    assert.equal(room.attemptNumber, 4);
    assert.equal(room.turnResult.outcome, "timeout");
  });

  // ----------------------------------------------------
  // TESTE 6: Acerto do palpite (handlePlayerGuess correto), pontuação e remoção da fila
  // ----------------------------------------------------
  test("Palpite correto: jogador sai da fila, recebe base + bônus de tempo e palavra é revelada", () => {
    const io = createMockIo();
    const gm = new GameManager(io);

    const room = gm.createRoom("p1", "Alice", {}, "🦁");
    const code = room.code;
    gm.joinRoom(code, "p2", "Bob", "🦊");
    gm.joinRoom(code, "p3", "Carlos", "🐼");

    room.state = "playing";
    room.unresolvedQueue = ["p1", "p2", "p3"];
    room.attemptNumber = 3; // Tentativa 3: base = 110 - 30 = 80

    const p1 = room.players.find((p) => p.id === "p1");
    p1.currentWord = { palavra: "Santos Dumont", categoriaNome: "História" };
    p1.score = 50;

    gm.startTurn(room);
    room.turnSecondsRemaining = 45; // 45s: bonus = Math.round(100 * 45/60) = 75

    // Pergunta e resposta
    gm.handleChatMessage(code, "p1", "Eu inventei o avião?");
    gm.handleQuickReaction(code, "p2", "yes");

    // Palpite correto com variações aceitas
    const guessRes = gm.handlePlayerGuess(code, "p1", "Eu sou o Santos Dumont!");
    assert.equal(guessRes.success, true);
    assert.equal(guessRes.correct, true);
    assert.equal(guessRes.base, 80, "Base da tentativa 3 deve ser 80");
    assert.equal(guessRes.bonus, 75, "Bônus com 45s de 60s deve ser 75");
    assert.equal(guessRes.earnedPoints, 155, "Total earned deve ser 80 + 75 = 155");

    assert.equal(p1.score, 50 + 155, "Pontuação deve somar com a anterior");
    assert.equal(p1.hasGuessed, true);
    assert.deepEqual(room.unresolvedQueue, ["p2", "p3"], "p1 deve ser removido da fila");
    assert.equal(room.attemptNumber, 4, "attemptNumber incrementa após acerto");

    // Palavra agora é revelada no resultado do turno
    assert.equal(room.turnResult.outcome, "correct");
    assert.equal(room.turnResult.word, "Santos Dumont");
  });

  // ----------------------------------------------------
  // TESTE 7: Jogador que já adivinhou continua podendo responder (SIM/NÃO/TALVEZ e Chat)
  // ----------------------------------------------------
  test("Jogador que acertou (hasGuessed = true) continua apto a responder e desbloquear vez do ativo", () => {
    const io = createMockIo();
    const gm = new GameManager(io);

    const room = gm.createRoom("p1", "Alice", {}, "🦁");
    const code = room.code;
    gm.joinRoom(code, "p2", "Bob", "🦊");

    room.state = "playing";
    room.unresolvedQueue = ["p2"]; // p1 já acertou e saiu da fila
    room.attemptNumber = 4;

    const p1 = room.players.find((p) => p.id === "p1");
    p1.hasGuessed = true;

    const p2 = room.players.find((p) => p.id === "p2");
    p2.currentWord = { palavra: "Chocolate", categoriaNome: "Comida" };

    gm.startTurn(room);
    assert.equal(room.activePlayerId, "p2");

    // p2 faz pergunta
    gm.handleChatMessage(code, "p2", "Eu sou doce?");
    assert.equal(room.turnPhase, "awaiting_responses");

    // p1 (que já acertou sua palavra) envia resposta rápida SIM
    gm.handleQuickReaction(code, "p1", "yes");

    // Deve ter desbloqueado a fase de palpite de p2
    assert.equal(room.turnPhase, "awaiting_guess_or_pass", "Resposta do jogador que já acertou deve desbloquear o turno");
    assert.equal(room.turnResponses.length, 1);
    assert.equal(room.turnResponses[0].senderId, "p1");
  });

  // ----------------------------------------------------
  // TESTE 8: Chat normal de espectador não desbloqueia se não for resposta válida
  // ----------------------------------------------------
  test("Chat comum de espectador não desbloqueia palpite; apenas respostas válidas (SIM/NÃO/TALVEZ)", () => {
    const io = createMockIo();
    const gm = new GameManager(io);

    const room = gm.createRoom("p1", "Alice", {}, "🦁");
    const code = room.code;
    gm.joinRoom(code, "p2", "Bob", "🦊");

    room.state = "playing";
    room.unresolvedQueue = ["p1", "p2"];

    gm.startTurn(room);
    gm.handleChatMessage(code, "p1", "Eu sou um animal?");
    assert.equal(room.turnPhase, "awaiting_responses");

    // p2 fala conversa paralela no chat
    gm.handleChatMessage(code, "p2", "espera aí que meu cachorro latiu aqui kkk");
    assert.equal(room.turnPhase, "awaiting_responses", "Conversa paralela não deve desbloquear");

    // p2 agora responde uma palavra afirmativa reconhecida
    gm.handleChatMessage(code, "p2", "Sim!");
    assert.equal(room.turnPhase, "awaiting_guess_or_pass", "Resposta reconhecida deve desbloquear");
  });

  // ----------------------------------------------------
  // TESTE 9: Último jogador na fila que erra/passa NÃO encerra a rodada precocemente
  // ----------------------------------------------------
  test("Último jogador restante na fila que erra ou passa permanece na fila e continua tentando", () => {
    const io = createMockIo();
    const gm = new GameManager(io);

    const room = gm.createRoom("p1", "Alice", {}, "🦁");
    const code = room.code;
    gm.joinRoom(code, "p2", "Bob", "🦊");

    room.state = "playing";
    room.currentRound = 1;
    room.settings.totalRounds = 3;
    room.unresolvedQueue = ["p2"]; // Apenas p2 falta acertar
    room.attemptNumber = 5;

    const p2 = room.players.find((p) => p.id === "p2");
    p2.currentWord = { palavra: "Piano", categoriaNome: "Instrumentos" };

    gm.startTurn(room);
    assert.equal(room.activePlayerId, "p2");

    // p2 pergunta e passa
    gm.handleChatMessage(code, "p2", "Sou de corda?");
    gm.handleQuickReaction(code, "p1", "yes");

    gm.skipTurn(code, "p2");

    // p2 deve continuar sendo o único na fila!
    assert.deepEqual(room.unresolvedQueue, ["p2"]);
    assert.equal(room.currentRound, 1, "Rodada NÃO pode avançar enquanto a fila tiver jogadores");
    assert.equal(room.attemptNumber, 6);

    // Quando p2 finalmente acertar:
    gm.startTurn(room);
    gm.handleChatMessage(code, "p2", "Eu sou o violão?");
    gm.handleQuickReaction(code, "p1", "no");
    gm.handlePlayerGuess(code, "p2", "Piano");

    assert.equal(room.unresolvedQueue.length, 0, "Fila deve ficar vazia");
    assert.equal(p2.hasGuessed, true);

    // Agora sim a rodada finaliza e avança
    gm.advanceTurn(room);
    assert.equal(room.currentRound, 2, "Rodada avança para 2 após todos acertarem");
    assert.equal(room.state, "word_suggestion", "Nova rodada inicia com sugestão de palavras");
    assert.equal(room.attemptNumber, 1, "attemptNumber reseta para 1 na nova rodada");
  });

  // ----------------------------------------------------
  // TESTE 10: Desconexão de jogadores (ativo vs espectador)
  // ----------------------------------------------------
  test("Desconexão do jogador ativo passa o turno para o próximo sem corromper a fila", () => {
    const io = createMockIo();
    const gm = new GameManager(io);

    const room = gm.createRoom("p1", "Alice", {}, "🦁");
    const code = room.code;
    gm.joinRoom(code, "p2", "Bob", "🦊");
    gm.joinRoom(code, "p3", "Carlos", "🐼");

    room.state = "playing";
    room.unresolvedQueue = ["p1", "p2", "p3"];

    gm.startTurn(room);
    assert.equal(room.activePlayerId, "p1");

    // p1 desconecta durante a vez dele
    gm.handleDisconnect("p1");

    assert.equal(room.players.length, 2);
    assert.deepEqual(room.unresolvedQueue, ["p2", "p3"]);
    assert.equal(room.activePlayerId, "p2", "Vez deve avançar para o próximo jogador (p2)");
  });

  test("Desconexão de espectador remove da fila sem alterar o jogador da vez atual", () => {
    const io = createMockIo();
    const gm = new GameManager(io);

    const room = gm.createRoom("p1", "Alice", {}, "🦁");
    const code = room.code;
    gm.joinRoom(code, "p2", "Bob", "🦊");
    gm.joinRoom(code, "p3", "Carlos", "🐼");

    room.state = "playing";
    room.unresolvedQueue = ["p1", "p2", "p3"];

    gm.startTurn(room);
    assert.equal(room.activePlayerId, "p1");

    // p3 (na fila, mas não é a vez dele) desconecta
    gm.handleDisconnect("p3");

    assert.equal(room.players.length, 2);
    assert.deepEqual(room.unresolvedQueue, ["p1", "p2"]);
    assert.equal(room.activePlayerId, "p1", "p1 continua ativo normalmente");
  });

  // ----------------------------------------------------
  // TESTE 11: Proteção Anti-Spoiler no chat
  // ----------------------------------------------------
  test("Espectador não pode vazar a palavra secreta no chat", () => {
    const io = createMockIo();
    const gm = new GameManager(io);

    const room = gm.createRoom("p1", "Alice", {}, "🦁");
    const code = room.code;
    gm.joinRoom(code, "p2", "Bob", "🦊");

    room.state = "playing";
    room.unresolvedQueue = ["p1", "p2"];

    const p1 = room.players.find((p) => p.id === "p1");
    p1.currentWord = { palavra: "Tartaruga", categoriaNome: "Animais" };

    gm.startTurn(room);

    // p2 tenta falar a palavra secreta de p1
    const res = gm.handleChatMessage(code, "p2", "Você é uma Tartaruga");
    assert.equal(res.type, "spoiler_blocked");

    // Mensagem de spoiler não entra no histórico global de chat desprotegida
    const containsSpoilerInHistory = room.chatMessages.some((m) => m.text && m.text.includes("Tartaruga"));
    assert.equal(containsSpoilerInHistory, false, "Palavra secreta não deve vazar no histórico do chat");

    // Verifica que o evento enviado ao jogador da vez (p1) foi censurado
    const p1CensoredMsg = io.events.find(
      (e) => e.room === "p1" && e.event === "new_chat_message" && e.data?.type === "censored"
    );
    assert.ok(p1CensoredMsg, "Jogador da vez deve receber versão censurada da mensagem");
    assert.equal(p1CensoredMsg.data.text, "[Mensagem oculta para não dar spoiler!]");
  });

  // ----------------------------------------------------
  // TESTE 20: Identidade Oficial e URL de Compartilhamento
  // ----------------------------------------------------
  test("URL oficial de compartilhamento utiliza https://quemsou.online", () => {
    assert.equal(OFFICIAL_DOMAIN, "https://quemsou.online");
    assert.equal(getShareUrl("ROOM5"), "https://quemsou.online/?room=ROOM5");

    // Simula acesso a partir de www.quemsou.online
    globalThis.window = {
      location: {
        origin: "https://www.quemsou.online",
        hostname: "www.quemsou.online"
      }
    };
    assert.equal(
      getShareUrl("K9X2P"),
      "https://quemsou.online/?room=K9X2P",
      "Acesso via www deve gerar link com domínio principal quemsou.online"
    );

    // Simula acesso em ambiente de desenvolvimento local (localhost)
    globalThis.window = {
      location: {
        origin: "http://localhost:5173",
        hostname: "localhost"
      }
    };
    assert.equal(
      getShareUrl("DEV01"),
      "http://localhost:5173/?room=DEV01",
      "Ambiente de teste local em localhost deve preservar a origem local"
    );

    delete globalThis.window;
  });

  // ----------------------------------------------------
  // TESTE 21: Suporte a IPs Privados IPv4 (172.16-31, 192.168, 10.x) e IPv6
  // ----------------------------------------------------
  test("isPrivateOrLocalHost valida estritamente faixas locais e privadas", () => {
    // Loopback
    assert.equal(isPrivateOrLocalHost("localhost"), true);
    assert.equal(isPrivateOrLocalHost("127.0.0.1"), true);
    assert.equal(isPrivateOrLocalHost("::1"), true);
    assert.equal(isPrivateOrLocalHost("[::1]"), true);

    // 10.0.0.0/8
    assert.equal(isPrivateOrLocalHost("10.0.0.1"), true);
    assert.equal(isPrivateOrLocalHost("10.255.255.254"), true);

    // 192.168.0.0/16
    assert.equal(isPrivateOrLocalHost("192.168.1.1"), true);
    assert.equal(isPrivateOrLocalHost("192.168.15.100"), true);

    // 172.16.0.0/12 (172.16.0.0 a 172.31.255.255)
    assert.equal(isPrivateOrLocalHost("172.16.0.1"), true, "172.16 é privado");
    assert.equal(isPrivateOrLocalHost("172.20.10.5"), true, "172.20 é privado");
    assert.equal(isPrivateOrLocalHost("172.31.255.254"), true, "172.31 é privado");

    // IPs públicos NÃO devem ser tratados como privados:
    assert.equal(isPrivateOrLocalHost("172.15.255.255"), false, "172.15 é público");
    assert.equal(isPrivateOrLocalHost("172.32.0.1"), false, "172.32 é público");
    assert.equal(isPrivateOrLocalHost("172.0.0.1"), false, "172.0 é público");
    assert.equal(isPrivateOrLocalHost("8.8.8.8"), false, "8.8.8.8 é público");
    assert.equal(isPrivateOrLocalHost("quemsou.online"), false, "quemsou.online é domínio oficial");
    assert.equal(isPrivateOrLocalHost(""), false, "vazio não é privado");
    assert.equal(isPrivateOrLocalHost(null), false, "null não é privado");

    // Teste de geração de share URL com IP privado vs público
    globalThis.window = {
      location: {
        origin: "http://172.20.1.5:3000",
        hostname: "172.20.1.5"
      }
    };
    assert.equal(
      getShareUrl("TEST1"),
      "http://172.20.1.5:3000/?room=TEST1",
      "Origem local em rede 172.20 deve ser mantida"
    );

    globalThis.window = {
      location: {
        origin: "https://172.32.1.5",
        hostname: "172.32.1.5"
      }
    };
    assert.equal(
      getShareUrl("TEST2"),
      "https://quemsou.online/?room=TEST2",
      "IP público 172.32 deve usar quemsou.online"
    );

    // Teste de codificação de caracteres especiais no código da sala
    assert.equal(
      getShareUrl("room code"),
      "https://quemsou.online/?room=ROOM%20CODE"
    );

    delete globalThis.window;
  });

  // ----------------------------------------------------
  // TESTE 22: Lógica de Rolagem Interna Inteligente do Chat
  // ----------------------------------------------------
  test("shouldFollowChatScroll e calculateRestoredScrollPosition preservam leitura", () => {
    // 1. shouldFollowChatScroll
    // Conteúdo cabe todo na tela sem rolagem:
    assert.equal(shouldFollowChatScroll(0, 300, 400), true);

    // Usuário exatamente no final: scrollHeight = 1000, clientHeight = 400, scrollTop = 600
    assert.equal(shouldFollowChatScroll(600, 1000, 400), true);

    // Usuário próximo do final dentro da tolerância (ex: 30px de distância, threshold = 60)
    // scrollTop = 570 => 1000 - 400 - 570 = 30 <= 60
    assert.equal(shouldFollowChatScroll(570, 1000, 400), true);

    // Usuário lendo mensagens antigas lá em cima (distância = 200px > 60)
    // scrollTop = 400 => 1000 - 400 - 400 = 200 > 60
    assert.equal(shouldFollowChatScroll(400, 1000, 400), false);

    // 2. calculateRestoredScrollPosition
    // Se estava no final antes da reconstrução do DOM, vai para o novo fim
    const posAtBottom = calculateRestoredScrollPosition({
      wasAtBottom: true,
      previousScrollTop: 600,
      newScrollHeight: 1200,
      clientHeight: 400
    });
    assert.equal(posAtBottom, 1200, "Deve ir para o final se estava no final");

    // Se estava rolando para cima lendo histórico, mantém o scrollTop anterior
    const posReading = calculateRestoredScrollPosition({
      wasAtBottom: false,
      previousScrollTop: 350,
      newScrollHeight: 1200,
      clientHeight: 400
    });
    assert.equal(posReading, 350, "Deve preservar posição anterior de leitura");

    // Se o novo conteúdo cabe na tela, restaura para o novo scrollHeight
    const posFits = calculateRestoredScrollPosition({
      wasAtBottom: false,
      previousScrollTop: 50,
      newScrollHeight: 200,
      clientHeight: 400
    });
    assert.equal(posFits, 200);
  });

  // ----------------------------------------------------
  // TESTE 23: Proteção de Timers de Transição e Reinício de Jogo
  // ----------------------------------------------------
  test("clearRoomTimers e scheduleTurnTransition protegem contra transições fantasmas", () => {
    const io = createMockIo();
    const gm = new GameManager(io);

    const room = gm.createRoom("p1", "Alice", {}, "🦁");
    const code = room.code;
    gm.joinRoom(code, "p2", "Bob", "🦊");

    room.state = "playing";
    room.unresolvedQueue = ["p1", "p2"];

    // Inicia turno de p1
    gm.startTurn(room);
    assert.ok(room.timerInterval, "Timer do turno deve estar ativo");

    // Agenda uma transição simulada de celebração
    room.state = "turn_celebration";
    gm.scheduleTurnTransition(room, 5000, "test_delay");
    assert.ok(room.transitionTimer, "transitionTimer deve estar registrado");
    assert.ok(room._executePendingTransition, "Callback de transição pendente deve ser exposto para teste");
    const token = room.transitionToken;
    const pendingCallback = room._executePendingTransition;

    // Se a sala avança ou limpa timers antes do timeout disparar:
    gm.clearRoomTimers(room);
    assert.equal(room.transitionTimer, null, "transitionTimer deve ser anulado");
    assert.notEqual(room.transitionToken, token, "transitionToken deve ser incrementado");

    // EXECUÇÃO FORÇADA DO CALLBACK APÓS INVALIDAÇÃO:
    // Mesmo que o callback seja invocado após o timer ser limpo/token alterado,
    // ele deve abortar sem executar advanceTurn nem trocar o jogador da vez
    const executed = pendingCallback();
    assert.equal(executed, false, "Callback cancelado deve retornar false e abortar");
    assert.equal(room.state, "turn_celebration", "Estado não deve ser alterado por callback invalidado");
    assert.equal(room.activePlayerId, "p1", "Jogador ativo não deve ser alterado por callback invalidado");
  });

  await asyncTest("Callback atrasado executado manualmente após clearRoomTimers é ignorado e o relógio falso não o dispara", async () => {
    await withFakeTimers(async () => {
      const { gm, room, code } = createPlayingRoom(3);
      const probe = instrumentTurns(gm);
      try {
        askAndAnswer(gm, room, "p2");
        gm.handlePlayerGuess(code, "p1", "Elefante");
        assert.equal(room.state, "turn_celebration");
        assert.ok(room.pendingTransition, "Tentativa encerrada deve registrar uma transição pendente");
        const staleCallback = room._executePendingTransition;
        assert.equal(typeof staleCallback, "function");
        probe.reset();

        // Qualquer limpeza de timers invalida a transição agendada
        gm.clearRoomTimers(room);
        assert.equal(room.transitionTimer, null);
        assert.equal(room.pendingTransition, null, "clearRoomTimers invalida a transição pendente");

        // Execução manual do callback atrasado: não pode avançar nada
        assert.equal(staleCallback(), false);
        // E avançar tempo no relógio falso também não dispara nada (o timer foi cancelado)
        mock.timers.tick(60000);

        assert.equal(probe.counts.startTurn, 0, "startTurn não pode ser chamado por callback invalidado");
        assert.equal(probe.counts.setInterval, 0, "Nenhum timer de turno pode ser criado");
        assert.equal(room.state, "turn_celebration");
        assert.equal(room.activePlayerId, "p1");
        assert.deepEqual(room.unresolvedQueue, ["p2", "p3", "p1"]);
        assert.equal(room.attemptNumber, 2);
      } finally {
        probe.restore();
        gm.clearRoomTimers(room);
      }
    });
  });

  await asyncTest("advanceTurn: chamadas duplicadas da mesma transição (sequenciais, async e Promise.all) iniciam o próximo turno uma única vez", async () => {
    await withFakeTimers(async () => {
      // Prepara uma tentativa encerrada (palpite errado) numa sala nova
      const prepare = () => {
        const env = createPlayingRoom(3);
        askAndAnswer(env.gm, env.room, "p2");
        env.gm.handlePlayerGuess(env.code, "p1", "Elefante");
        assert.equal(env.room.state, "turn_celebration");
        env.seq = env.room.pendingTransition.turnSeq;
        assert.equal(env.seq, env.room.turnSeq, "A transição pendente pertence à tentativa que acabou de terminar");
        return env;
      };

      const assertAdvancedExactlyOnce = (env, probe, label) => {
        assert.equal(probe.counts.startTurn, 1, `${label}: startTurn deve ser chamado exatamente 1 vez`);
        assert.equal(countStateUpdates(env.io), 3, `${label}: 1 atualização de estado por jogador (3), sem duplicar`);
        assert.equal(probe.counts.setInterval, 1, `${label}: exatamente 1 timer de turno criado`);
        assert.equal(countTurnAnnouncements(env.io), 1, `${label}: apenas 1 aviso de "É a vez de"`);
        assert.equal(env.room.state, "playing");
        assert.equal(env.room.activePlayerId, "p2");
        assert.equal(env.room.turnSeq, env.seq + 1, `${label}: turnSeq avança exatamente uma vez`);
        assert.equal(env.room.pendingTransition, null, `${label}: transição consumida`);
        assert.equal(env.room.attemptNumber, 2, `${label}: contador de tentativas preservado`);
        assert.deepEqual(env.room.unresolvedQueue, ["p2", "p3", "p1"], `${label}: fila preservada`);
        assert.equal(env.room.turnSecondsRemaining, env.room.settings.turnTime, `${label}: timer reiniciado uma vez`);
      };

      // (a) Duas chamadas síncronas em sequência, com o id explícito da transição
      {
        const env = prepare();
        const probe = instrumentTurns(env.gm);
        try {
          probe.reset();
          env.io.clearEvents();
          const first = env.gm.advanceTurn(env.room, "dup_1", env.seq);
          const second = env.gm.advanceTurn(env.room, "dup_2", env.seq);
          assert.equal(first, true, "Primeira chamada consome a transição");
          assert.equal(second, false, "Segunda chamada da mesma transição retorna sem fazer nada");
          assertAdvancedExactlyOnce(env, probe, "sequencial");
        } finally {
          probe.restore();
          env.gm.clearRoomTimers(env.room);
        }
      }

      // (b) Promise.all com chamadas diretas e com chamadas assíncronas (a flag liberada no finally não protegeria)
      {
        const env = prepare();
        const probe = instrumentTurns(env.gm);
        try {
          probe.reset();
          env.io.clearEvents();
          const results = await Promise.all([
            env.gm.advanceTurn(env.room, "all_1"),
            env.gm.advanceTurn(env.room, "all_2"),
            (async () => env.gm.advanceTurn(env.room, "all_3"))(),
            Promise.resolve().then(() => env.gm.advanceTurn(env.room, "all_4", env.seq))
          ]);
          assert.deepEqual(results, [true, false, false, false]);
          assertAdvancedExactlyOnce(env, probe, "Promise.all");
        } finally {
          probe.restore();
          env.gm.clearRoomTimers(env.room);
        }
      }

      // (c) Callback agendado (relógio falso) + chamada manual antes do disparo
      {
        const env = prepare();
        const probe = instrumentTurns(env.gm);
        try {
          probe.reset();
          env.io.clearEvents();
          mock.timers.tick(3499);
          assert.equal(probe.counts.startTurn, 0, "Antes do atraso de 3500ms nada avança");
          mock.timers.tick(1);
          assert.equal(env.gm.advanceTurn(env.room, "late_manual"), false, "Chamada manual após o callback agendado não avança de novo");
          assertAdvancedExactlyOnce(env, probe, "callback agendado");
        } finally {
          probe.restore();
          env.gm.clearRoomTimers(env.room);
        }
      }

      // (d) Uma transição diferente e válida no turno seguinte continua funcionando
      {
        const env = prepare();
        const probe = instrumentTurns(env.gm);
        try {
          assert.equal(env.gm.advanceTurn(env.room, "first", env.seq), true);
          assert.equal(env.room.activePlayerId, "p2");

          askAndAnswer(env.gm, env.room, "p3");
          env.gm.handlePlayerGuess(env.code, "p2", "Violao");
          assert.equal(env.room.state, "turn_celebration");
          const nextSeq = env.room.pendingTransition.turnSeq;
          assert.notEqual(nextSeq, env.seq, "Cada tentativa tem a sua própria transição");

          probe.reset();
          env.io.clearEvents();
          // Chamada atrasada da transição anterior não pode avançar o turno seguinte
          assert.equal(env.gm.advanceTurn(env.room, "stale", env.seq), false);
          assert.equal(probe.counts.startTurn, 0);
          assert.equal(env.room.state, "turn_celebration");
          assert.equal(env.room.activePlayerId, "p2");
          assert.ok(env.room.pendingTransition, "Transição atual segue pendente após chamada obsoleta");

          // A transição válida do turno seguinte avança normalmente (callback real do relógio falso)
          mock.timers.tick(3500);
          assert.equal(probe.counts.startTurn, 1);
          assert.equal(probe.counts.setInterval, 1);
          assert.equal(countStateUpdates(env.io), 3);
          assert.equal(env.room.activePlayerId, "p3");
          assert.equal(env.room.attemptNumber, 3);
          assert.deepEqual(env.room.unresolvedQueue, ["p3", "p1", "p2"]);
        } finally {
          probe.restore();
          env.gm.clearRoomTimers(env.room);
        }
      }
    });
  });

  await asyncTest("Desconexão do jogador ativo concorrendo com a transição agendada: apenas um dos dois avança a partida", async () => {
    await withFakeTimers(async () => {
      // (a) Desconexão acontece antes do callback agendado
      {
        const { io, gm, room, code } = createPlayingRoom(3);
        const probe = instrumentTurns(gm);
        try {
          askAndAnswer(gm, room, "p2");
          gm.handlePlayerGuess(code, "p1", "Elefante");
          const scheduledCallback = room._executePendingTransition;
          assert.equal(typeof scheduledCallback, "function");
          probe.reset();
          io.clearEvents();

          gm.handleDisconnect("p1");

          assert.equal(probe.counts.startTurn, 1, "Desconexão avança exatamente uma vez");
          assert.equal(room.activePlayerId, "p2");
          assert.deepEqual(room.unresolvedQueue, ["p2", "p3"]);
          assert.equal(room.attemptNumber, 2, "Tentativa não é contada de novo");

          // O callback antigo (manual ou via relógio) não pode avançar uma segunda vez
          assert.equal(scheduledCallback(), false);
          mock.timers.tick(5000);
          assert.equal(probe.counts.startTurn, 1, "Callback agendado não avança depois da desconexão");
          assert.equal(room.activePlayerId, "p2");
          assert.equal(countTurnAnnouncements(io), 1);
        } finally {
          probe.restore();
          gm.clearRoomTimers(room);
        }
      }

      // (b) O callback agendado dispara antes; depois o jogador que já jogou se desconecta
      {
        const { io, gm, room, code } = createPlayingRoom(3);
        const probe = instrumentTurns(gm);
        try {
          askAndAnswer(gm, room, "p2");
          gm.handlePlayerGuess(code, "p1", "Elefante");
          probe.reset();
          io.clearEvents();

          mock.timers.tick(3500);
          assert.equal(probe.counts.startTurn, 1);
          assert.equal(room.activePlayerId, "p2");
          const seqAfterAdvance = room.turnSeq;

          // p1 não é mais o jogador da vez: sua saída não pode avançar o turno de p2
          gm.handleDisconnect("p1");
          assert.equal(probe.counts.startTurn, 1, "Saída de quem não é da vez não avança a partida");
          assert.equal(room.activePlayerId, "p2");
          assert.equal(room.turnSeq, seqAfterAdvance);
          assert.deepEqual(room.unresolvedQueue, ["p2", "p3"]);
          assert.equal(countTurnAnnouncements(io), 1);
        } finally {
          probe.restore();
          gm.clearRoomTimers(room);
        }
      }
    });
  });

  await asyncTest("restartGame é rejeitado em playing e turn_celebration (sem alterar a partida) e aceito apenas pelo Host após game_over", async () => {
    await withFakeTimers(async () => {
      const { io, gm, room, code } = createPlayingRoom(2, { totalRounds: 1 });
      try {
        // Durante o turno (playing)
        assert.equal(await gm.restartGame(code, "p1"), false, "Não pode reiniciar durante o jogo em andamento");
        assert.equal(room.state, "playing");

        // p1 acerta -> turn_celebration
        askAndAnswer(gm, room, "p2");
        gm.handlePlayerGuess(code, "p1", "Girafa");
        assert.equal(room.state, "turn_celebration");
        const seqDuringCelebration = room.pendingTransition.turnSeq;
        io.clearEvents();

        assert.equal(await gm.restartGame(code, "p1"), false, "Host não pode reiniciar durante turn_celebration");
        assert.equal(room.state, "turn_celebration", "Estado preservado");
        assert.equal(room.pendingTransition?.turnSeq, seqDuringCelebration, "Transição pendente preservada");
        assert.ok(room.transitionTimer, "Timer de transição preservado");
        assert.ok(
          io.events.some((e) => e.room === "p1" && e.event === "guess_feedback"),
          "Host recebe o aviso de que só é possível reiniciar após o término"
        );
        assert.equal(room.players.find((p) => p.id === "p1").score > 0, true, "Pontuação preservada");

        // A transição agendada continua funcionando normalmente
        mock.timers.tick(4000);
        assert.equal(room.state, "playing");
        assert.equal(room.activePlayerId, "p2");

        // p2 acerta -> fila vazia -> rodada final termina -> game_over
        askAndAnswer(gm, room, "p1");
        gm.handlePlayerGuess(code, "p2", "Piano");
        assert.equal(room.state, "turn_celebration");
        assert.equal(await gm.restartGame(code, "p1"), false, "Rejeitado também na última celebração");
        mock.timers.tick(4000);
        assert.equal(room.state, "game_over");

        // Após game_over: não-host rejeitado, Host aceito
        assert.equal(await gm.restartGame(code, "p2"), false, "Não-host não pode reiniciar");
        assert.equal(room.state, "game_over");
        const restarted = await gm.restartGame(code, "p1");
        assert.ok(restarted && restarted.success, "Host pode reiniciar após game_over");
        assert.equal(room.state, "word_suggestion");
        assert.equal(room.currentRound, 1);
        assert.ok(room.players.every((p) => p.score === 0), "Placar reseta para 0");
        assert.equal(room.pendingTransition, null);
        assert.equal(room.transitionTimer, null);
      } finally {
        gm.clearRoomTimers(room);
      }
    });
  });

  // ----------------------------------------------------
  // TESTE 24: Desconexão do Jogador Ativo (Incremento de Tentativa e Race Conditions)
  // ----------------------------------------------------
  test("Desconexão do jogador ativo em mid-turn incrementa attemptNumber uma única vez", () => {
    const io = createMockIo();
    const gm = new GameManager(io);

    const room = gm.createRoom("p1", "Alice", {}, "🦁");
    const code = room.code;
    gm.joinRoom(code, "p2", "Bob", "🦊");
    gm.joinRoom(code, "p3", "Carol", "🐼");

    room.state = "playing";
    room.unresolvedQueue = ["p1", "p2", "p3"];
    room.attemptNumber = 1;

    gm.startTurn(room);
    assert.equal(room.activePlayerId, "p1");
    assert.equal(room.turnEnded, false);

    // p1 desconecta no meio do turno sem jogar:
    gm.handleDisconnect("p1");

    assert.equal(room.attemptNumber, 2, "Tentativa deve incrementar exatamente 1 vez por abandono de turno");
    assert.equal(room.activePlayerId, "p2", "Vez passa para p2");
    assert.deepEqual(room.unresolvedQueue, ["p2", "p3"]);
  });

  test("Desconexão do jogador ativo durante celebração NÃO incrementa attemptNumber novamente", () => {
    const io = createMockIo();
    const gm = new GameManager(io);

    const room = gm.createRoom("p1", "Alice", {}, "🦁");
    const code = room.code;
    gm.joinRoom(code, "p2", "Bob", "🦊");

    room.state = "playing";
    room.unresolvedQueue = ["p1", "p2"];
    room.attemptNumber = 1;

    const p1 = room.players.find((p) => p.id === "p1");
    p1.currentWord = { palavra: "Girafa", categoriaNome: "Animais" };

    gm.startTurn(room);

    // p1 faz a pergunta e p2 responde para liberar palpite
    gm.handleChatMessage(code, "p1", "Eu sou um animal?");
    gm.handleQuickReaction(code, "p2", "yes");

    // p1 erra o palpite -> entra em turn_celebration e attemptNumber vai para 2
    gm.handlePlayerGuess(code, "p1", "Elefante");
    assert.equal(room.state, "turn_celebration");
    assert.equal(room.attemptNumber, 2);
    assert.equal(room.turnEnded, true);

    // Enquanto está na celebração com delay agendado, p1 desconecta:
    gm.handleDisconnect("p1");

    // attemptNumber NÃO deve ser incrementado novamente (continua 2, não vira 3)
    assert.equal(room.attemptNumber, 2, "Não deve duplicar incremento de tentativa na celebração");
    assert.equal(room.transitionTimer, null, "transitionTimer deve ter sido limpo");
  });

  test("Desconexão do último jogador da fila encerra a rodada imediatamente", () => {
    const io = createMockIo();
    const gm = new GameManager(io);

    const room = gm.createRoom("p1", "Alice", {}, "🦁");
    const code = room.code;
    gm.joinRoom(code, "p2", "Bob", "🦊");

    room.state = "playing";
    // p2 já acertou na rodada (não está mais na fila de não resolvidos)
    room.unresolvedQueue = ["p1"];
    room.players.find((p) => p.id === "p2").hasGuessed = true;

    gm.startTurn(room);
    assert.equal(room.activePlayerId, "p1");

    // p1 (único restante na fila) desconecta:
    gm.handleDisconnect("p1");

    // A fila fica vazia -> a rodada avança para a próxima
    assert.equal(room.currentRound, 2, "Rodada avança para 2 após o último na fila desconectar");
    assert.equal(room.state, "word_suggestion", "Entra na fase de sugestão da rodada 2");
  });

  // ----------------------------------------------------
  // TESTE 29: Tutorial de Regras Integrado
  // ----------------------------------------------------
  test("Tutorial de Regras: 9 pontos de regra, abertura, fechamento e invariância de estado", () => {
    // 1. Validação dos 9 pontos de regra oficiais
    assert.equal(TUTORIAL_RULES.length, 9, "Deve conter exatamente 9 pontos de regra");
    assert.ok(TUTORIAL_RULES[0].includes("palavra secreta") && TUTORIAL_RULES[0].includes("não vê"), "Ponto 1: palavra na testa oculta para o próprio");
    assert.ok(TUTORIAL_RULES[1].includes("uma pergunta"), "Ponto 2: exatamente uma pergunta por tentativa");
    assert.ok(TUTORIAL_RULES[2].includes("primeira resposta") && TUTORIAL_RULES[2].includes("palpite ou passar"), "Ponto 3: liberação de palpite/passagem");
    assert.ok(TUTORIAL_RULES[3].includes("apenas um") && TUTORIAL_RULES[3].includes("encerra"), "Ponto 4: palpite único e encerramento");
    assert.ok(TUTORIAL_RULES[4].includes("responder enquanto o turno estiver aberto"), "Ponto 5: respostas adicionais permitidas");
    assert.ok(TUTORIAL_RULES[5].includes("fim da fila") && TUTORIAL_RULES[5].includes("mesma palavra"), "Ponto 6: rotação ao fim com mesma palavra");
    assert.ok(TUTORIAL_RULES[6].includes("sai da fila") && TUTORIAL_RULES[6].includes("responder"), "Ponto 7: acertador sai da fila mas responde");
    assert.ok(TUTORIAL_RULES[7].includes("todos os participantes elegíveis acertarem"), "Ponto 8: rodada termina com todos acertando");
    assert.ok(TUTORIAL_RULES[8].includes("base") && TUTORIAL_RULES[8].includes("bônus"), "Ponto 9: pontuação base decrescente + bônus de tempo");

    // 2. Mock DOM para testar abertura e fechamento
    const dom = setupMockDom();

    // Configura estado inicial do jogo para testar invariância
    state.roomCode = "TUT01";
    state.room = { code: "TUT01", state: "lobby" };
    state.wordDraft = { word: "Rascunho", category: "Geral" };
    state.chatMessages = [{ id: "m1", text: "Mensagem anterior" }];
    state.currentScreen = "home";

    // Abre o modal
    const modalBackdrop = openTutorialModal();
    assert.ok(modalBackdrop, "Modal deve ser criado");
    assert.equal(modalBackdrop.getAttribute("role"), "dialog");
    assert.equal(modalBackdrop.getAttribute("aria-modal"), "true");
    assert.ok(document.getElementById("tutorial-modal-backdrop"), "Backdrop deve estar presente no DOM");
    assert.ok(document.getElementById("btn-close-tutorial"), "Botão de fechar deve existir");

    // Fechamento pelo botão de fechar
    const closeBtn = document.getElementById("btn-close-tutorial");
    closeBtn.dispatch("click");
    assert.equal(document.getElementById("tutorial-modal-backdrop"), null, "Modal deve fechar no clique");

    // Reabre e testa fechamento pela tecla Escape
    openTutorialModal();
    assert.ok(document.getElementById("tutorial-modal-backdrop"));
    window.dispatchKeydown("Escape");
    assert.equal(document.getElementById("tutorial-modal-backdrop"), null, "Modal deve fechar na tecla Escape");

    // Confirma invariância estrita de estado: nenhum dado do jogo foi alterado
    assert.equal(state.roomCode, "TUT01");
    assert.equal(state.wordDraft.word, "Rascunho");
    assert.equal(state.chatMessages.length, 1);
    assert.equal(state.currentScreen, "home");

    dom.cleanup();
  });

  test("Tutorial: telas Home e Lobby renderizam o botão \"?\" e ambos abrem o mesmo conteúdo", () => {
    const dom = setupMockDom();
    try {
      const app = dom.registerElement("app");

      state.myId = "me";
      state.roomCode = "TUT02";
      state.room = {
        code: "TUT02",
        hostId: "me",
        state: "lobby",
        settings: { categories: ["animais"], turnTime: 60, totalRounds: 3 },
        players: [{ id: "me", name: "Eu", avatar: "🦊" }]
      };
      state.wordDraft = { word: "Rascunho", category: "Animais" };
      state.chatMessages = [{ id: "m1", text: "Mensagem anterior", type: "chat" }];
      const stateBefore = structuredClone({
        roomCode: state.roomCode,
        room: state.room,
        wordDraft: state.wordDraft,
        chatMessages: state.chatMessages
      });
      const assertStateUnchanged = (label) => {
        assert.deepEqual(
          { roomCode: state.roomCode, room: state.room, wordDraft: state.wordDraft, chatMessages: state.chatMessages },
          stateBefore,
          `${label}: sala, rascunho de palavra e histórico do chat não podem mudar`
        );
      };

      // Regex: um <button id="btn-open-tutorial" ...> cujo texto visível é apenas "?"
      const helpButtonRegex = /<button[^>]*id="btn-open-tutorial"[^>]*>\s*\?\s*<\/button>/;
      const expectedRulesHtml = TUTORIAL_RULES.map((rule) => escapeHtml(rule));
      const openedContents = {};

      for (const screen of ["home", "lobby"]) {
        state.currentScreen = screen;
        renderCurrentScreen();

        // A tela REALMENTE renderizada contém o botão "?" acessível
        assert.ok(helpButtonRegex.test(app.innerHTML), `${screen}: botão "?" deve estar na tela renderizada`);
        assert.ok(app.innerHTML.includes('aria-label="Como jogar / Tutorial de Regras"'), `${screen}: botão com nome acessível`);
        const helpButton = document.getElementById("btn-open-tutorial");
        assert.ok(helpButton, `${screen}: botão "?" registrado no DOM`);
        const appHtmlBefore = app.innerHTML;

        // Abrir pelo botão "?"
        helpButton.dispatch("click");
        const backdrop = document.getElementById("tutorial-modal-backdrop");
        assert.ok(backdrop, `${screen}: clique no "?" abre o tutorial`);
        assert.equal(backdrop.getAttribute("role"), "dialog");
        assert.equal(backdrop.getAttribute("aria-modal"), "true");
        assert.equal(backdrop.getAttribute("aria-labelledby"), "tutorial-modal-title");
        assert.ok(backdrop.innerHTML.includes('id="tutorial-modal-title"'), `${screen}: título acessível presente`);
        assert.equal((backdrop.innerHTML.match(/<li\b/g) || []).length, 9, `${screen}: 9 pontos de regra exibidos`);
        for (const ruleHtml of expectedRulesHtml) {
          assert.ok(backdrop.innerHTML.includes(ruleHtml), `${screen}: regra exibida no modal`);
        }
        openedContents[screen] = backdrop.innerHTML;

        // Foco inicial no próprio diálogo
        assert.equal(document.activeElement.id, "tutorial-modal-container", `${screen}: foco inicial no diálogo`);
        // Abrir não redesenha a tela nem altera o estado
        assert.equal(app.innerHTML, appHtmlBefore, `${screen}: abrir o tutorial não redesenha a tela`);
        assert.equal(state.currentScreen, screen);
        assertStateUnchanged(`${screen} (aberto)`);

        // Abrir de novo não duplica o modal
        helpButton.dispatch("click");
        assert.equal(document.getElementById("tutorial-modal-backdrop"), backdrop, `${screen}: não duplica o modal`);

        // (1) Fechar pelo botão ✕ -> foco volta ao "?"
        document.getElementById("btn-close-tutorial").dispatch("click");
        assert.equal(document.getElementById("tutorial-modal-backdrop"), null, `${screen}: fecha pelo botão ✕`);
        assert.equal(document.activeElement, helpButton, `${screen}: foco retorna ao botão "?" (✕)`);

        // (2) Fechar pelo botão "Entendi"
        helpButton.dispatch("click");
        assert.ok(document.getElementById("tutorial-modal-backdrop"));
        document.getElementById("btn-confirm-tutorial").dispatch("click");
        assert.equal(document.getElementById("tutorial-modal-backdrop"), null, `${screen}: fecha pelo botão "Entendi"`);
        assert.equal(document.activeElement, helpButton, `${screen}: foco retorna ao botão "?" (Entendi)`);

        // (3) Fechar clicando no backdrop (clique dentro do painel NÃO fecha)
        helpButton.dispatch("click");
        const reopened = document.getElementById("tutorial-modal-backdrop");
        assert.ok(reopened);
        const panel = document.getElementById("tutorial-modal-container");
        reopened.dispatch("click", { target: panel });
        assert.ok(document.getElementById("tutorial-modal-backdrop"), `${screen}: clique dentro do painel não fecha`);
        reopened.dispatch("click", { target: reopened });
        assert.equal(document.getElementById("tutorial-modal-backdrop"), null, `${screen}: fecha ao clicar no backdrop`);
        assert.equal(document.activeElement, helpButton, `${screen}: foco retorna ao botão "?" (backdrop)`);

        // (4) Fechar com Escape
        helpButton.dispatch("click");
        assert.ok(document.getElementById("tutorial-modal-backdrop"));
        window.dispatchKeydown("Escape");
        assert.equal(document.getElementById("tutorial-modal-backdrop"), null, `${screen}: fecha com Escape`);
        assert.equal(document.activeElement, helpButton, `${screen}: foco retorna ao botão "?" (Escape)`);
        assert.equal(window.keydownListenerCount(), 0, `${screen}: listener de teclado removido ao fechar`);

        assert.equal(app.innerHTML, appHtmlBefore, `${screen}: tela intacta após abrir e fechar várias vezes`);
        assertStateUnchanged(`${screen} (fechado)`);
      }

      // Os dois botões abrem exatamente o mesmo conteúdo
      assert.equal(openedContents.home, openedContents.lobby, "Home e Lobby abrem o mesmo conteúdo do tutorial");

      // Se a tela for redesenhada com o modal aberto, o foco volta ao "?" da tela atual
      state.currentScreen = "home";
      renderCurrentScreen();
      const staleButton = document.getElementById("btn-open-tutorial");
      staleButton.dispatch("click");
      assert.ok(document.getElementById("tutorial-modal-backdrop"));
      renderCurrentScreen();
      const freshButton = document.getElementById("btn-open-tutorial");
      assert.notEqual(freshButton, staleButton, "Botão foi recriado pelo novo render");
      window.dispatchKeydown("Escape");
      assert.equal(document.activeElement, freshButton, "Foco vai para o botão \"?\" atual quando o original saiu do DOM");
    } finally {
      dom.cleanup();
    }
  });

  test("Tutorial: contenção de foco com Tab e Shift+Tab dentro do modal", () => {
    // Função pura: ordem do DOM = [fechar ✕, conteúdo rolável, Entendi]
    assert.deepEqual(TUTORIAL_FOCUSABLE_IDS, ["btn-close-tutorial", "tutorial-modal-content", "btn-confirm-tutorial"]);
    assert.equal(getTutorialFocusTarget("btn-confirm-tutorial", false), "btn-close-tutorial", "Tab no último volta ao primeiro");
    assert.equal(getTutorialFocusTarget("btn-close-tutorial", true), "btn-confirm-tutorial", "Shift+Tab no primeiro vai ao último");
    assert.equal(getTutorialFocusTarget("tutorial-modal-container", true), "btn-confirm-tutorial", "Shift+Tab no diálogo vai ao último");
    assert.equal(getTutorialFocusTarget("tutorial-modal-container", false), null, "Tab no diálogo segue o fluxo natural (primeiro item)");
    assert.equal(getTutorialFocusTarget("tutorial-modal-content", false), null, "Tab no meio segue o fluxo natural");
    assert.equal(getTutorialFocusTarget("tutorial-modal-content", true), null, "Shift+Tab no meio segue o fluxo natural");
    assert.equal(getTutorialFocusTarget("btn-close-tutorial", false), null);
    assert.equal(getTutorialFocusTarget("", false), "btn-close-tutorial", "Foco fora do modal é trazido de volta");
    assert.equal(getTutorialFocusTarget("btn-create-room", true), "btn-confirm-tutorial", "Foco fora do modal é trazido de volta");

    // Integração com o modal aberto
    const dom = setupMockDom();
    try {
      openTutorialModal();
      assert.equal(document.activeElement.id, "tutorial-modal-container");

      // Shift+Tab a partir do diálogo: vai para o último e impede o comportamento padrão
      let ev = window.dispatchKeydown("Tab", { shiftKey: true });
      assert.equal(ev.defaultPrevented, true);
      assert.equal(document.activeElement.id, "btn-confirm-tutorial");

      // Tab no último: volta ao primeiro
      ev = window.dispatchKeydown("Tab");
      assert.equal(ev.defaultPrevented, true);
      assert.equal(document.activeElement.id, "btn-close-tutorial");

      // Shift+Tab no primeiro: vai ao último
      ev = window.dispatchKeydown("Tab", { shiftKey: true });
      assert.equal(ev.defaultPrevented, true);
      assert.equal(document.activeElement.id, "btn-confirm-tutorial");

      // Foco no conteúdo rolável: Tab e Shift+Tab seguem o fluxo natural do navegador
      document.getElementById("tutorial-modal-content").focus();
      ev = window.dispatchKeydown("Tab");
      assert.equal(ev.defaultPrevented, false);
      ev = window.dispatchKeydown("Tab", { shiftKey: true });
      assert.equal(ev.defaultPrevented, false);
      assert.equal(document.activeElement.id, "tutorial-modal-content");

      // Depois de fechado, Tab não é mais interceptado
      closeTutorialModal();
      ev = window.dispatchKeydown("Tab", { shiftKey: true });
      assert.equal(ev.defaultPrevented, false);
    } finally {
      dom.cleanup();
    }
  });

  // ----------------------------------------------------
  // TESTE 30: Proporção das Colunas do Tabuleiro Desktop
  // ----------------------------------------------------
  test("Proporção do layout desktop: 3/12 Placar, 4/12 Palco Central e 5/12 Chat", () => {
    assert.equal(BOARD_LAYOUT_SPANS.scoreboard, 3, "Placar deve ocupar 3 colunas");
    assert.equal(BOARD_LAYOUT_SPANS.centerStage, 4, "Palco Central deve ocupar 4 colunas");
    assert.equal(BOARD_LAYOUT_SPANS.chat, 5, "Chat deve ocupar 5 colunas");
    assert.equal(
      BOARD_LAYOUT_SPANS.scoreboard + BOARD_LAYOUT_SPANS.centerStage + BOARD_LAYOUT_SPANS.chat,
      12,
      "A soma das 3 colunas deve ser exatamente 12"
    );
  });

  test("Layout desktop renderizado no tabuleiro usa lg:col-span-3 / 4 / 5 em grade de 12 colunas e empilha no mobile", () => {
    const dom = setupMockDom();
    try {
      const app = dom.registerElement("app");
      state.myId = "p2";
      state.roomCode = "LAY01";
      state.chatMessages = [];
      state.room = {
        code: "LAY01",
        hostId: "p1",
        state: "playing",
        settings: { categories: ["animais"], turnTime: 60, totalRounds: 3 },
        currentRound: 1,
        attemptNumber: 1,
        activePlayerId: "p1",
        activePlayerName: "Alice",
        activePlayerAvatar: "🦁",
        turnPhase: "awaiting_question",
        turnEnded: false,
        turnSecondsRemaining: 60,
        unresolvedQueueCount: 2,
        players: [
          { id: "p1", name: "Alice", avatar: "🦁", score: 0, isHost: true, hasGuessed: false, isInQueue: true, currentWord: "???" },
          { id: "p2", name: "Bob", avatar: "🦊", score: 0, isHost: false, hasGuessed: false, isInQueue: true, currentWord: { palavra: "Piano", categoriaNome: "Objetos" } }
        ]
      };
      state.currentScreen = "game";
      renderCurrentScreen();

      const html = app.innerHTML;
      assert.ok(html.includes("grid grid-cols-1 lg:grid-cols-12"), "Grade: 1 coluna no mobile (empilhado) e 12 colunas em lg");
      const spans = [...html.matchAll(/lg:col-span-(\d+)/g)].map((m) => Number(m[1]));
      assert.deepEqual(spans, [3, 4, 5], "Ordem no DOM: placar (3), palco central (4), chat (5)");
      assert.equal(spans.reduce((a, b) => a + b, 0), 12);
      assert.ok(!/(?<![\w:-])col-span-\d+/.test(html.replace(/lg:col-span-\d+/g, "")), "Nenhum col-span sem prefixo lg: que quebre o empilhamento mobile");
    } finally {
      dom.cleanup();
    }
  });

  // ----------------------------------------------------
  // TESTE 36: Payloads inválidos em Socket.IO não derrubam o servidor
  // ----------------------------------------------------
  await asyncTest("Socket.IO rejeita payloads inválidos sem alterar o jogo e continua aceitando evento válido", async () => {
    const realtime = await createRealtimeSocketServer();
    const client = await realtime.connect();
    const events = [
      "create_room", "join_room", "update_settings", "game:start", "start_game",
      "word:submit", "submit_word", "game:distribute", "distribute_words",
      "chat:message", "chat_message", "turn:guess", "guess_word",
      "quick:reaction", "quick_reaction", "turn:skip", "skip_turn",
      "game:restart", "restart_game"
    ];
    const invalidPayloads = [null, "inválido", 42, []];

    try {
      for (const eventName of events) {
        for (const payload of invalidPayloads) {
          const result = await emitWithAck(client, eventName, payload);
          assert.equal(result.success, false, `${eventName} deve rejeitar ${String(payload)}`);
          assert.equal(result.error, "Dados inválidos para esta ação.");
        }

        const omittedPayload = await emitWithAck(client, eventName);
        assert.equal(omittedPayload.success, false, `${eventName} deve rejeitar payload omitido`);
      }

      assert.equal(realtime.gameManager.rooms.size, 0, "Payloads inválidos não podem criar salas");

      const validResult = await emitWithAck(client, "create_room", {
        name: "Jogador válido",
        settings: { turnTime: 60, totalRounds: 1 }
      });
      assert.equal(validResult.success, true, "O servidor deve continuar aceitando eventos válidos");
      assert.equal(realtime.gameManager.rooms.size, 1, "Evento válido cria uma sala após os inválidos");
    } finally {
      client.disconnect();
      await realtime.close();
    }
  });

  // ----------------------------------------------------
  // TESTE 37: Mapeamento de tela por estado da sala e sigilo no card de celebração
  // ----------------------------------------------------
  test("getScreenForRoomState mapeia todos os estados da sala e turn_celebration preserva sigilo em erro/passagem/timeout", () => {
    assert.equal(getScreenForRoomState("lobby"), "lobby");
    assert.equal(getScreenForRoomState("word_suggestion"), "word_suggestion");
    assert.equal(getScreenForRoomState("playing"), "game");
    assert.equal(getScreenForRoomState("turn_celebration"), "game");
    assert.equal(getScreenForRoomState("game_over"), "podium");
    assert.equal(getScreenForRoomState(undefined), "lobby");

    // safeStorage nunca lança exceção mesmo sem localStorage
    assert.equal(safeStorage.getItem("chave_inexistente"), null);
    assert.doesNotThrow(() => safeStorage.setItem("chave_teste", "valor"));

    const dom = setupMockDom();
    try {
      const app = dom.registerElement("app");
      state.myId = "p1";
      state.roomCode = "CEL01";
      state.chatMessages = [];
      state.currentScreen = "game";

      // 1. Celebração de palpite errado: NÃO deve exibir "A palavra secreta era:"
      state.room = {
        code: "CEL01",
        hostId: "p1",
        state: "turn_celebration",
        settings: { categories: ["animais"], turnTime: 60, totalRounds: 3 },
        currentRound: 1,
        attemptNumber: 2,
        activePlayerId: "p1",
        activePlayerName: "Alice",
        activePlayerAvatar: "🦁",
        turnPhase: "awaiting_guess_or_pass",
        turnEnded: true,
        turnResult: { outcome: "wrong", player: "Alice", avatar: "🦁", guess: "Elefante" },
        wordRevealed: null,
        turnSecondsRemaining: 40,
        unresolvedQueueCount: 2,
        players: [
          { id: "p1", name: "Alice", avatar: "🦁", score: 0, isHost: true, hasGuessed: false, isInQueue: true, currentWord: { palavra: "???", categoriaNome: "Animais" } },
          { id: "p2", name: "Bob", avatar: "🦊", score: 0, isHost: false, hasGuessed: false, isInQueue: true, currentWord: { palavra: "Piano", categoriaNome: "Objetos" } }
        ]
      };
      renderCurrentScreen();
      assert.ok(
        app.innerHTML.includes("A palavra continua secreta para a próxima tentativa na fila!"),
        "Em erro/passagem/timeout o card informa que a palavra continua secreta"
      );
      assert.ok(
        !app.innerHTML.includes("A palavra secreta era:"),
        "Em erro não exibe 'A palavra secreta era:'"
      );

      // 2. Celebração de acerto: exibe a palavra revelada
      state.room.turnResult = { outcome: "correct", player: "Alice", avatar: "🦁", word: "Girafa", points: 180 };
      state.room.wordRevealed = "Girafa";
      renderCurrentScreen();
      assert.ok(app.innerHTML.includes("A palavra secreta era:"), "Em acerto exibe o rótulo da palavra revelada");
      assert.ok(app.innerHTML.includes("Girafa"), "Em acerto exibe a palavra revelada");
    } finally {
      dom.cleanup();
    }
  });

  console.log("==================================================");
  console.log(` RESULTADO FINAL: ${passedCount} / ${totalCount} TESTES PASSARAM!`);
  console.log("==================================================");

  if (passedCount !== totalCount) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error("Erro fatal durante a execução dos testes:", err);
  process.exit(1);
});
