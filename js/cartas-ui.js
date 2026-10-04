/* ==========================================================================
   Duelo da Zoeira · js/cartas-ui.js
   Monta o HTML das cartas (frente e verso) e textos auxiliares.
   Usado pelo catálogo, pelo deck e pela arena.
   ========================================================================== */

import { COSMETICOS, skinDe } from "./cosmeticos.js?v=202610041639";

// Emblema do careca (logo, verso das cartas e ícone do site)
export const SVG_CARECA = `
<svg viewBox="0 0 64 64" aria-hidden="true" class="emblema-careca">
  <ellipse cx="13.5" cy="31" rx="3.5" ry="5" fill="#c98a5c"/>
  <ellipse cx="50.5" cy="31" rx="3.5" ry="5" fill="#c98a5c"/>
  <ellipse cx="32" cy="27" rx="18" ry="20" fill="#e3ab7c"/>
  <ellipse cx="32" cy="34" rx="16" ry="12" fill="#c98a5c" opacity=".35"/>
  <path d="M14.5 31c0 17 9 29 17.5 29s17.5-12 17.5-29c-3 8-9 11-17.5 11S17.5 39 14.5 31z" fill="#2b1d14"/>
  <path d="M24 42.5c3-2.5 13-2.5 16 0-3 1.2-13 1.2-16 0z" fill="#1b120c"/>
  <path d="M28 46.5h8" stroke="#c46a6a" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M21 26.5l7 1.6M43 26.5l-7 1.6" stroke="#2b1d14" stroke-width="2.4" stroke-linecap="round"/>
  <circle cx="26" cy="31" r="1.5" fill="#2b1d14"/><circle cx="38" cy="31" r="1.5" fill="#2b1d14"/>
  <ellipse cx="25" cy="14" rx="7" ry="4" fill="#fff" opacity=".55" transform="rotate(-20 25 14)"/>
  <path d="M44 6l1.2 3.3 3.3 1.2-3.3 1.2L44 15l-1.2-3.3-3.3-1.2 3.3-1.2z" fill="#fff8d0"/>
</svg>`;

export const ATRIBUTOS = {
  TERRA: { chave: "terra", kanji: "地", nome: "Terra" },
  TREVAS: { chave: "trevas", kanji: "闇", nome: "Trevas" },
  LUZ: { chave: "luz", kanji: "光", nome: "Luz" },
  GELO: { chave: "gelo", kanji: "氷", nome: "Gelo" },
  VENTO: { chave: "vento", kanji: "風", nome: "Vento" },
  INTERNET: { chave: "internet", kanji: "网", nome: "Internet" },
  DIVINO: { chave: "divino", kanji: "神", nome: "Divino" },
  MAGIA: { chave: "magia", kanji: "魔", nome: "Magia" },
  ARMADILHA: { chave: "armadilha", kanji: "罠", nome: "Armadilha" },
};

const RARIDADES = {
  Comum: "comum",
  Rara: "rara",
  "Super Rara": "super",
  "Ultra Rara": "ultra",
  "Lendária da Zoeira": "lendaria",
};

const SUBTIPOS_MAGIA = {
  normal: { nome: "Normal", icone: "" },
  rapida: { nome: "Rápida", icone: "⚡" },
  equipamento: { nome: "Equipamento", icone: "✚" },
  continua: { nome: "Contínua", icone: "∞" },
  campo: { nome: "Campo", icone: "🏟" },
};

// Monstros com efeito VIRE (flip)
const ehVire = (c) => Boolean(c.efeito && c.efeito.startsWith("flip-"));

export function moldura(c) {
  if (c.categoria === "monstro") {
    if (c.atributo === "DIVINO") return "divino"; // cartas de Deus: moldura azul (continuam no deck normal)
    return c.subtipo === "fusao" ? "fusao" : c.subtipo === "normal" ? "normal" : "efeito";
  }
  return c.categoria;
}

export function nomeCategoria(c) {
  if (c.categoria === "monstro") return c.subtipo === "fusao" ? "Monstro de Fusão" : c.subtipo === "normal" ? "Monstro Normal" : "Monstro de Efeito";
  if (c.categoria === "magia") return "Magia";
  return "Armadilha";
}

export function nomeSubtipo(c) {
  if (c.categoria === "monstro") return c.subtipo === "fusao" ? "Fusão / Efeito" : ehVire(c) ? "Virar / Efeito" : c.subtipo === "normal" ? "Normal" : "Efeito";
  return SUBTIPOS_MAGIA[c.subtipo]?.nome || "Normal";
}

export function linhaTipo(c) {
  if (c.categoria !== "monstro") return "";
  if (c.subtipo === "normal") return `[${c.tipo}]`;
  if (c.subtipo === "fusao") return `[${c.tipo} / Fusão / Efeito]`;
  if (ehVire(c)) return `[${c.tipo} / Virar / Efeito]`;
  return `[${c.tipo} / Efeito]`;
}

export function atributoDaCarta(c) {
  if (c.categoria === "magia") return ATRIBUTOS.MAGIA;
  if (c.categoria === "armadilha") return ATRIBUTOS.ARMADILHA;
  return ATRIBUTOS[c.atributo];
}

export const chaveRaridade = (c) => RARIDADES[c.raridade] || "comum";

// Número de série "de verdade" (8 dígitos) derivado do id da carta
function numeroDeSerie(id) {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return String(h >>> 0).padStart(10, "0").slice(-8);
}

function tamanhoTexto(texto) {
  const n = texto.length;
  if (n < 80) return "3.7cqw";
  if (n < 130) return "3.4cqw";
  if (n < 175) return "3.15cqw";
  if (n < 280) return "2.9cqw";
  // textos enormes (Davi, George, Big Animal, Grande Mestre do Caos...): letra menor para caber na caixa
  if (n < 295) return "2.75cqw";
  if (n < 330) return "2.45cqw";
  if (n < 440) return "2.2cqw";
  if (n < 500) return "2.05cqw";
  if (n < 560) return "1.95cqw";
  // Mago Dragão Sonho do BIG: o maior texto do jogo
  return "1.75cqw";
}

// Nome muito comprido: em vez de encolher demais numa linha só, quebra em duas
// (no espaço que deixa as duas linhas mais parecidas)
function linhasDoNome(nome) {
  if (nome.length <= 26) return null;
  let melhor = null;
  for (let i = nome.indexOf(" "); i > 0; i = nome.indexOf(" ", i + 1)) {
    const a = nome.slice(0, i).trim();
    const b = nome.slice(i + 1).trim();
    const maior = Math.max(a.length, b.length);
    if (a && b && (!melhor || maior < melhor.maior)) melhor = { a, b, maior };
  }
  return melhor;
}

function el(tag, classe, texto) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

/* Cria a frente de uma carta.
   opcoes.atk / opcoes.def: valores atuais (mostram verde/vermelho se mudaram)
   opcoes.contador: número grande sobre a arte (turnos restantes)
   opcoes.tag: elemento raiz ("article", "div", "button"...) */
export function criarCarta(c, opcoes = {}) {
  const raiz = el(opcoes.tag || "div", "carta" + (opcoes.classe ? " " + opcoes.classe : ""));
  raiz.dataset.moldura = moldura(c);
  raiz.dataset.subtipo = c.subtipo;
  raiz.dataset.raridade = chaveRaridade(c);
  raiz.dataset.cartaId = c.id;

  const corpo = el("div", "carta__corpo");

  // Nome e atributo
  const topo = el("div", "carta__topo");
  const nome = el("span", "carta__nome", c.nome);
  const linhas = linhasDoNome(c.nome);
  if (linhas) {
    nome.textContent = `${linhas.a}
${linhas.b}`;
    nome.classList.add("carta__nome--duas-linhas");
  }
  nome.style.setProperty("--letras", Math.max(linhas ? linhas.maior : c.nome.length, 11));
  const attr = atributoDaCarta(c);
  const icone = el("span", "carta__atributo");
  icone.dataset.atributo = attr.chave;
  icone.dataset.rotulo = attr.nome.toUpperCase();
  icone.append(el("span", "", attr.kanji));
  icone.setAttribute("aria-hidden", "true");
  topo.append(nome, icone);

  // Estrelas ou tipo de Magia/Armadilha
  const linha = el("div", "carta__linha-nivel");
  if (c.categoria === "monstro") {
    for (let i = 0; i < c.nivel; i++) linha.append(el("span", "estrela", "★"));
    linha.setAttribute("aria-label", `Nível ${c.nivel}`);
  } else {
    const rotulo = c.categoria === "magia" ? "Carta de Magia" : "Carta de Armadilha";
    const sub = el("span", "carta__subtipo", `[${rotulo}`);
    const info = SUBTIPOS_MAGIA[c.subtipo];
    if (info && info.icone) {
      const ic = el("span", "carta__subtipo-icone", info.icone);
      ic.title = `${c.categoria === "magia" ? "Magia" : "Armadilha"} ${info.nome}`;
      sub.append(ic);
    }
    sub.append("]");
    linha.append(sub);
  }

  // Arte
  const molduraArte = el("div", "carta__arte-moldura");
  const img = el("img", "carta__arte");
  img.src = c.imagem;
  img.alt = opcoes.alt ?? "";
  img.width = 640;
  img.height = 640;
  img.loading = opcoes.lazy === false ? "eager" : "lazy";
  img.draggable = false;
  molduraArte.append(img);

  const codigo = el("div", "carta__codigo-linha");
  codigo.append(el("span", "", "1ª Edição"), el("span", "", c.codigo));

  // Caixa de texto
  const caixa = el("div", "carta__caixa");
  if (c.categoria === "monstro") caixa.append(el("p", "carta__tipo", linhaTipo(c)));
  const texto = el("p", "carta__texto", c.texto);
  texto.style.setProperty("--tam-texto", tamanhoTexto(c.texto));
  caixa.append(texto);

  const seloStats = el("div", "carta__selo-stats");
  if (c.categoria === "monstro") {
    const atk = opcoes.atk ?? c.atk;
    const stats = el("p", "carta__stats");
    const sAtk = el("span", "", `ATK/${atk}`);
    const sDef = el("span", "", `DEF/${c.def}`);
    if (atk > c.atk) sAtk.classList.add("stat-mais");
    if (atk < c.atk) sAtk.classList.add("stat-menos");
    stats.append(sAtk, sDef);
    caixa.append(stats);

    const bAtk = el("span", "", String(atk));
    if (atk > c.atk) bAtk.classList.add("stat-mais");
    const bDef = el("small", "", String(c.def));
    seloStats.append(bAtk, bDef);
  } else {
    seloStats.textContent = c.categoria === "magia" ? "MAGIA" : "ARMADILHA";
  }
  caixa.append(seloStats);

  const rodape = el("div", "carta__rodape");
  rodape.append(el("span", "", numeroDeSerie(c.id)), el("span", "", "©2026 RPG DA ZOEIRA"), el("span", "carta__selo"));

  corpo.append(topo, linha, molduraArte, codigo, caixa, rodape);
  raiz.append(corpo);

  if (opcoes.contador) {
    const cont = el("span", "carta__contador", String(opcoes.contador));
    cont.title = "Turnos restantes";
    raiz.append(cont);
  }
  return raiz;
}

// versoId: as costas que o dono da carta equipou (cosmético), ou nada para as costas padrão
export function criarVerso(classe = "", versoId = null) {
  const verso = el("div", "carta-verso" + (classe ? " " + classe : ""));
  const corpo = el("div", "carta-verso__corpo");
  const skin = skinDe(versoId, "verso");
  if (skin) {
    verso.dataset.skin = skin;
    verso.style.setProperty("--verso-img", `url("${new URL(COSMETICOS[versoId].imagem, document.baseURI).href}")`);
    corpo.append(el("span", "carta-verso__brilho"));
  }
  const logo = el("div", "carta-verso__logo");
  logo.innerHTML = `${SVG_CARECA.replace('class="emblema-careca"', 'class="carta-verso__careca"')}
    <span class="carta-verso__texto">ZOEIRA<small>DUELO</small></span>`;
  corpo.append(logo);
  verso.append(corpo);
  verso.setAttribute("aria-hidden", "true");
  return verso;
}

// Texto curto de ATK/DEF ou categoria (para listas e leitores de tela)
export function resumoCarta(c) {
  if (c.categoria === "monstro") return `${nomeCategoria(c)} · Nível ${c.nivel} · ATK ${c.atk} / DEF ${c.def}`;
  return `${nomeCategoria(c)} ${nomeSubtipo(c)}`;
}
