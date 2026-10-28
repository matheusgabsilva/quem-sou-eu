import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const wordsFilePath = join(__dirname, "..", "data", "palavras.json");

let wordDatabase = null;

export async function loadWords() {
  if (wordDatabase) return wordDatabase;
  try {
    const rawData = await readFile(wordsFilePath, "utf-8");
    wordDatabase = JSON.parse(rawData);
    return wordDatabase;
  } catch (error) {
    console.error("Erro ao carregar banco de palavras:", error);
    // Fallback básico caso haja erro de leitura
    wordDatabase = {
      celebridades: [
        { palavra: "Silvio Santos", dica: "Apresentador de TV icônico" },
        { palavra: "Pelé", dica: "O Rei do Futebol" },
        { palavra: "Anitta", dica: "Cantora pop" }
      ],
      desenhos: [
        { palavra: "Bob Esponja", dica: "Mora no fundo do mar" },
        { palavra: "Mickey Mouse", dica: "Camundongo da Disney" }
      ],
      animais: [
        { palavra: "Capivara", dica: "Maior roedor do mundo" },
        { palavra: "Leão", dica: "Rei da Selva" }
      ],
      objetos: [
        { palavra: "Liquidificador", dica: "Eletrodoméstico de cozinha" },
        { palavra: "Celular", dica: "Aparelho portátil" }
      ]
    };
    return wordDatabase;
  }
}

export async function getAvailableCategories() {
  const db = await loadWords();
  return Object.keys(db).map((key) => {
    const labels = {
      celebridades: "Celebridades",
      desenhos: "Personagens de Desenho",
      animais: "Animais",
      objetos: "Objetos",
      profissoes: "Profissões"
    };
    return {
      id: key,
      label: labels[key] || key.charAt(0).toUpperCase() + key.slice(1),
      count: db[key].length
    };
  });
}

// Sorteia uma palavra aleatória respeitando categorias e evitando palavras já usadas
export async function pickRandomWord(selectedCategories = [], usedWords = new Set()) {
  const db = await loadWords();
  const allCategories = Object.keys(db);
  const categoriesToUse =
    selectedCategories && selectedCategories.length > 0
      ? selectedCategories.filter((cat) => allCategories.includes(cat))
      : allCategories;

  const validCategories = categoriesToUse.length > 0 ? categoriesToUse : allCategories;

  // Junta todas as palavras das categorias válidas
  const pool = [];
  for (const cat of validCategories) {
    for (const item of db[cat] || []) {
      pool.push({
        ...item,
        categoriaId: cat,
        categoriaNome: getCategoryName(cat)
      });
    }
  }

  // Tenta encontrar palavras que ainda não foram usadas
  const available = pool.filter((item) => !usedWords.has(item.palavra.toLowerCase()));

  if (available.length > 0) {
    const chosen = available[Math.floor(Math.random() * available.length)];
    usedWords.add(chosen.palavra.toLowerCase());
    return chosen;
  }

  // Se esgotou todas as palavras da categoria, reseta o histórico e sorteia do pool completo
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  return chosen;
}

export function getCategoryName(catKey) {
  const labels = {
    celebridades: "Celebridades",
    desenhos: "Personagens de Desenho",
    animais: "Animais",
    objetos: "Objetos",
    profissoes: "Profissões"
  };
  return labels[catKey] || catKey;
}
