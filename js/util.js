/* ==========================================================================
   Duelo da Zoeira · js/util.js
   Funções pequenas usadas em vários lugares.
   ========================================================================== */

// Cria um elemento com classe e texto
export function el(tag, classe, texto) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto !== undefined && texto !== null) e.textContent = texto;
  return e;
}

// Tira acentos e deixa minúsculo (busca "dragao" encontra "Dragão")
export function normalizar(texto) {
  return String(texto).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Nick -> chave usada nos tópicos (sem acento, minúsculo, só letras/números/_)
export function chaveDoNick(nick) {
  return normalizar(nick).replace(/[^a-z0-9_]/g, "");
}

export function gerarId(tamanho = 10) {
  const letras = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(tamanho));
  return Array.from(bytes, (b) => letras[b % letras.length]).join("");
}

export function hora(t = Date.now()) {
  return new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Aviso rápido no canto da tela
export function aviso(texto, tipo = "info", duracao = 4000) {
  const area = document.querySelector("#avisos");
  const caixa = el("div", "aviso", texto);
  caixa.dataset.tipo = tipo;
  caixa.setAttribute("role", tipo === "erro" ? "alert" : "status");
  area.append(caixa);
  setTimeout(() => caixa.remove(), duracao);
}

// localStorage pode falhar (modo privado, bloqueio): nunca deixa o site quebrar
export const guardar = {
  ler(chave, padrao = null, sessao = false) {
    try {
      const bruto = (sessao ? sessionStorage : localStorage).getItem(chave);
      return bruto === null ? padrao : JSON.parse(bruto);
    } catch {
      return padrao;
    }
  },
  gravar(chave, valor, sessao = false) {
    try {
      (sessao ? sessionStorage : localStorage).setItem(chave, JSON.stringify(valor));
    } catch { /* sem armazenamento: segue sem lembrar */ }
  },
  apagar(chave, sessao = false) {
    try {
      (sessao ? sessionStorage : localStorage).removeItem(chave);
    } catch { /* idem */ }
  },
};

// Nível a partir da experiência (vitória = 100 XP, derrota = 40 XP)
export function nivelDoXp(xp = 0) {
  return Math.min(99, Math.floor(xp / 200) + 1);
}

export function progressoNivel(xp = 0) {
  return (xp % 200) / 200;
}
