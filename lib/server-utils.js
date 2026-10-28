import { networkInterfaces } from "node:os";

// Gera um código de 5 caracteres amigável (sem caracteres ambíguos como 0/O, 1/I)
export function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

// Descobre os endereços IPv4 locais (para permitir conexão via celular no mesmo Wi-Fi)
export function localAddresses() {
  const addresses = [];
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

// Envia resposta JSON padrão HTTP
export function sendJson(res, status, data) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*"
  });
  res.end(JSON.stringify(data));
}

// Normaliza texto para validação de palpites no chat (remove acentos, pontuação, caixa alta)
export function normalizeText(text) {
  if (!text || typeof text !== "string") return "";
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?'"“”]/g, "") // remove pontuação
    .replace(/\s+/g, " ")
    .trim();
}

// Calcula a distância de Levenshtein entre duas strings
export function levenshteinDistance(a, b) {
  const s1 = normalizeText(a);
  const s2 = normalizeText(b);

  if (s1 === s2) return 0;
  if (!s1.length) return s2.length;
  if (!s2.length) return s1.length;

  const matrix = Array.from({ length: s1.length + 1 }, () => 
    new Array(s2.length + 1).fill(0)
  );

  for (let i = 0; i <= s1.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= s2.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deleção
        matrix[i][j - 1] + 1,      // inserção
        matrix[i - 1][j - 1] + cost // substituição
      );
    }
  }

  return matrix[s1.length][s2.length];
}

// Verifica se um palpite está próximo ou é exato
export function evaluateGuess(guessText, secretWord) {
  const normGuess = normalizeText(guessText);
  const normSecret = normalizeText(secretWord);

  // Palpite exato
  if (normGuess === normSecret) {
    return { isCorrect: true, isClose: false };
  }

  // Permite expressões comuns do jogador como "eu sou o silvio santos?", "e o silvio santos", "sou o silvio santos"
  const cleanGuess = normGuess
    .replace(/^(eu sou|sou|e o|e a|seria o|seria a|acho que e|sera que sou|acho que sou)\s+/, "")
    .trim();

  if (cleanGuess === normSecret) {
    return { isCorrect: true, isClose: false };
  }

  // Verifica se está muito próximo (Levenshtein <= 2 para palavras com mais de 4 letras)
  const dist = levenshteinDistance(cleanGuess, normSecret);
  const isClose = normSecret.length >= 4 && dist > 0 && dist <= 2;

  return { isCorrect: false, isClose };
}

// Verifica se a mensagem de um jogador contém spoiler da palavra secreta
export function containsSpoiler(messageText, secretWord) {
  const normMsg = normalizeText(messageText);
  const normSecret = normalizeText(secretWord);

  if (normSecret.length < 3) return false;
  return normMsg.includes(normSecret);
}
