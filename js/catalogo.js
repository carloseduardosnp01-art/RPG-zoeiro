/* ==========================================================================
   Duelo da Zoeira · js/catalogo.js
   Catálogo (busca, filtros, ordenação e paginação), modal de detalhes,
   leque de cartas do início e a mesa do deck.
   ========================================================================== */

import { criarCarta, nomeCategoria, nomeSubtipo, atributoDaCarta, chaveRaridade, moldura } from "./cartas-ui.js?v=202610031522";
import { el, normalizar } from "./util.js?v=202610031522";

const CARTAS_POR_PAGINA = 12;
const ORDEM_RARIDADE = ["Comum", "Rara", "Super Rara", "Ultra Rara", "Lendária da Zoeira"];

const estado = {
  cartas: [],
  resultado: [],
  pagina: 1,
  listaDoModal: [],
  posicaoNoModal: 0,
};

const campos = {
  busca: document.querySelector("#filtro-busca"),
  ordem: document.querySelector("#filtro-ordem"),
  categoria: document.querySelector("#filtro-categoria"),
  atributo: document.querySelector("#filtro-atributo"),
  raridade: document.querySelector("#filtro-raridade"),
};
const listaCartas = document.querySelector("#lista-cartas");
const statusCatalogo = document.querySelector("#status-catalogo");
const contagem = document.querySelector("#contagem-resultados");
const paginacao = document.querySelector("#paginacao");

let modal = null; // bootstrap.Modal (criado sob demanda)


/* ---------- Início ---------- */

export function iniciarCatalogo(cartas) {
  estado.cartas = cartas;

  document.querySelector("#form-filtros").addEventListener("input", () => {
    estado.pagina = 1;
    aplicarFiltros();
  });
  document.querySelector("#form-filtros").addEventListener("submit", (e) => e.preventDefault());
  document.querySelector("#botao-limpar").addEventListener("click", limparFiltros);

  document.querySelector("#detalhe-anterior").addEventListener("click", () => navegarModal(-1));
  document.querySelector("#detalhe-proxima").addEventListener("click", () => navegarModal(1));

  aplicarFiltros();
  montarLeque();
  montarDeck();
}

function limparFiltros() {
  document.querySelector("#form-filtros").reset();
  estado.pagina = 1;
  aplicarFiltros();
  campos.busca.focus();
}


/* ---------- Filtros, ordenação e paginação ---------- */

function aplicarFiltros() {
  const busca = normalizar(campos.busca.value.trim());
  const categoria = campos.categoria.value;
  const atributo = campos.atributo.value;
  const raridade = campos.raridade.value;

  estado.resultado = estado.cartas
    .filter((c) => !busca || normalizar(`${c.codigo} ${c.nome} ${c.texto} ${c.tipo || ""}`).includes(busca))
    .filter((c) => !categoria || nomeCategoria(c) === categoria)
    .filter((c) => !atributo || (c.atributo || c.categoria.toUpperCase()) === atributo)
    .filter((c) => !raridade || c.raridade === raridade);

  ordenar(estado.resultado, campos.ordem.value);
  mostrarPagina();
}

function ordenar(lista, criterio) {
  const porCodigo = (a, b) => a.codigo.localeCompare(b.codigo);
  const regras = {
    codigo: porCodigo,
    nome: (a, b) => a.nome.localeCompare(b.nome, "pt-BR"),
    atk: (a, b) => (b.atk ?? -1) - (a.atk ?? -1) || porCodigo(a, b),
    nivel: (a, b) => (b.nivel ?? 0) - (a.nivel ?? 0) || porCodigo(a, b),
    raridade: (a, b) => ORDEM_RARIDADE.indexOf(b.raridade) - ORDEM_RARIDADE.indexOf(a.raridade) || porCodigo(a, b),
  };
  lista.sort(regras[criterio] || porCodigo);
}

function mostrarPagina() {
  const total = estado.resultado.length;
  const paginas = Math.max(1, Math.ceil(total / CARTAS_POR_PAGINA));
  estado.pagina = Math.min(estado.pagina, paginas);
  const inicio = (estado.pagina - 1) * CARTAS_POR_PAGINA;
  const daPagina = estado.resultado.slice(inicio, inicio + CARTAS_POR_PAGINA);

  listaCartas.replaceChildren();
  statusCatalogo.replaceChildren();

  if (!total) {
    contagem.textContent = "Nenhuma carta encontrada.";
    const vazio = el("div", "estado");
    vazio.append(el("p", "", "Nenhuma carta corresponde à busca ou aos filtros escolhidos. Nem o Careca Cast Surpresa achou."));
    const botao = el("button", "btn btn-outline-light", "Limpar filtros");
    botao.type = "button";
    botao.addEventListener("click", limparFiltros);
    vazio.append(botao);
    statusCatalogo.append(vazio);
    paginacao.hidden = true;
    return;
  }

  contagem.textContent = `Exibindo ${inicio + 1}–${inicio + daPagina.length} de ${total} carta${total > 1 ? "s" : ""}`;
  for (const c of daPagina) listaCartas.append(criarItemCatalogo(c));
  montarPaginacao(paginas);
}

function criarItemCatalogo(c) {
  const coluna = el("div", "col");
  const item = el("article", "item-catalogo");
  const botao = el("button", "item-catalogo__botao");
  botao.type = "button";
  botao.setAttribute("aria-label", `Ver detalhes de ${c.nome}`);
  botao.append(criarCarta(c, { alt: "" }));
  botao.addEventListener("click", () => abrirDetalhes(c.id, estado.resultado));

  const info = el("div", "item-catalogo__info");
  info.append(el("span", "", c.copias ? `${c.codigo} · ${c.copias}x no deck padrão` : `${c.codigo} · carta extra`));
  if (c.limite !== undefined && c.limite < 3) info.append(el("span", "selo-limite", c.limite === 0 ? "Banida" : `Limitada a ${c.limite}`));
  const selo = el("span", "selo-raridade", c.raridade);
  selo.dataset.raridade = chaveRaridade(c);
  info.append(selo);

  item.append(botao, info);
  coluna.append(item);
  return coluna;
}

function montarPaginacao(paginas) {
  paginacao.replaceChildren();
  paginacao.hidden = paginas <= 1;
  if (paginas <= 1) return;

  const ul = el("ul", "pagination");
  const item = (rotulo, pagina, { ativo = false, desativado = false, aria } = {}) => {
    const li = el("li", "page-item" + (ativo ? " active" : "") + (desativado ? " disabled" : ""));
    const b = el("button", "page-link", rotulo);
    b.type = "button";
    if (aria) b.setAttribute("aria-label", aria);
    if (ativo) b.setAttribute("aria-current", "page");
    b.disabled = desativado;
    b.addEventListener("click", () => {
      estado.pagina = pagina;
      mostrarPagina();
      contagem.scrollIntoView({ block: "start" });
    });
    li.append(b);
    return li;
  };
  ul.append(item("‹", estado.pagina - 1, { desativado: estado.pagina === 1, aria: "Página anterior" }));
  for (let p = 1; p <= paginas; p++) ul.append(item(String(p), p, { ativo: p === estado.pagina }));
  ul.append(item("›", estado.pagina + 1, { desativado: estado.pagina === paginas, aria: "Próxima página" }));
  paginacao.append(ul);
}


/* ---------- Modal de detalhes ---------- */

export function abrirDetalhes(idCarta, lista = estado.cartas) {
  estado.listaDoModal = lista.length ? lista : estado.cartas;
  estado.posicaoNoModal = Math.max(0, estado.listaDoModal.findIndex((c) => c.id === idCarta));
  preencherDetalhes();
  if (!modal) modal = new bootstrap.Modal("#modal-carta");
  modal.show();
}

function navegarModal(passo) {
  const n = estado.listaDoModal.length;
  estado.posicaoNoModal = (estado.posicaoNoModal + passo + n) % n;
  preencherDetalhes();
}

function preencherDetalhes() {
  const c = estado.listaDoModal[estado.posicaoNoModal];
  document.querySelector("#modal-carta-titulo").textContent = c.nome;
  document.querySelector("#detalhe-carta").replaceChildren(criarCarta(c, { alt: `Arte da carta ${c.nome}`, lazy: false }));

  const ficha = document.querySelector("#detalhe-ficha");
  ficha.replaceChildren();
  const linha = (rotulo, valor) => {
    const d = el("div", "col-6 col-lg-4");
    d.append(el("dt", "", rotulo), el("dd", "", valor));
    ficha.append(d);
  };
  linha("Código", c.codigo);
  linha("Categoria", nomeCategoria(c));
  linha("Tipo", c.categoria === "monstro" ? `${c.tipo} · ${nomeSubtipo(c)}` : nomeSubtipo(c));
  linha("Atributo", atributoDaCarta(c).nome);
  if (c.categoria === "monstro") {
    linha("Nível", `${"★".repeat(c.nivel)} (${c.nivel})`);
    linha("ATK / DEF", `${c.atk} / ${c.def}`);
    const t = c.nivel >= 7 ? 2 : c.nivel >= 5 ? 1 : 0;
    linha("Tributos", t ? `${t} monstro${t > 1 ? "s" : ""}` : "Nenhum");
  }
  linha("Raridade", c.raridade);
  if (c.limite !== undefined && c.limite < 3) linha("Limite", c.limite === 0 ? "Banida" : `${c.limite} cópia${c.limite > 1 ? "s" : ""} por deck`);
  linha("Deck padrão", c.copias ? `${c.copias} cópia${c.copias > 1 ? "s" : ""}` : "Não está (use no seu deck)");

  document.querySelector("#detalhe-texto").textContent = c.texto;
  document.querySelector("#detalhe-como").textContent = c.comoFunciona;
  document.querySelector("#detalhe-frase").textContent = c.frase;
  document.querySelector("#detalhe-posicao").textContent = `${estado.posicaoNoModal + 1} de ${estado.listaDoModal.length}`;
}


/* ---------- Leque do início ---------- */

function montarLeque() {
  const leque = document.querySelector("#leque");
  const escolhidas = [
    ["forca-careca", "esquerda"],
    ["careca-do-pt", "direita"],
    ["grande-mestre", "centro"],
  ];
  for (const [id, lado] of escolhidas) {
    const c = estado.cartas.find((x) => x.id === id);
    const b = el("button", `leque__carta leque__carta--${lado}`);
    b.type = "button";
    b.setAttribute("aria-label", `Ver detalhes de ${c.nome}`);
    b.append(criarCarta(c, { lazy: false }));
    b.addEventListener("click", () => abrirDetalhes(id));
    leque.append(b);
  }
}


/* ---------- Mesa do deck ---------- */

function montarDeck() {
  const mesa = document.querySelector("#mesa-deck");
  const grupos = [
    ["Monstros", (c) => c.categoria === "monstro"],
    ["Magias", (c) => c.categoria === "magia"],
    ["Armadilhas", (c) => c.categoria === "armadilha"],
  ];

  // Totais calculados com reduce
  const total = estado.cartas.reduce((t, c) => t + c.copias, 0);
  const porGrupo = grupos.map(([nome, filtro]) => [nome, estado.cartas.filter(filtro).reduce((t, c) => t + c.copias, 0)]);
  document.querySelector("#resumo-deck").textContent =
    `${total} cartas: ` + porGrupo.map(([nome, n]) => `${n} ${nome.toLowerCase()}`).join(", ") + ".";

  for (const [nome, filtro] of grupos) {
    const cartas = estado.cartas.filter((c) => c.copias > 0 && filtro(c));
    const qtd = cartas.reduce((t, c) => t + c.copias, 0);
    const grupo = el("section", "grupo-deck");
    grupo.append(el("h3", "", `${nome} (${qtd})`));
    const linha = el("div", "row row-cols-3 row-cols-sm-4 row-cols-lg-6 row-cols-xl-7 g-3");
    for (const c of cartas) {
      const col = el("div", "col");
      const pilha = el("button", "pilha");
      pilha.type = "button";
      pilha.dataset.copias = c.copias;
      pilha.dataset.moldura = moldura(c);
      pilha.setAttribute("aria-label", `${c.nome}, ${c.copias} cópias. Ver detalhes`);
      pilha.append(criarCarta(c), el("span", "pilha__copias", `${c.copias}x`));
      pilha.addEventListener("click", () => abrirDetalhes(c.id, cartas));
      col.append(pilha);
      linha.append(col);
    }
    grupo.append(linha);
    mesa.append(grupo);
  }
}
