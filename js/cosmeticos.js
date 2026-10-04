/* ==========================================================================
   Duelo da Zoeira · js/cosmeticos.js
   Cosméticos: moldura do avatar, skin do campo e costas das cartas. Só mudam o
   visual. Cada um custa 50 Careca Coins na Loja (aba Cosméticos) ou sai na Roleta
   Diária. O equipado fica no perfil ("visual") e vai junto para os duelos: o
   oponente vê a sua moldura, o seu campo e as costas das suas cartas.
   Para criar um novo: a imagem em img/cosmeticos/ e uma linha em COSMETICOS
   (e o id em v_cosmeticos no supabase/banco.sql, para a roleta poder dar).
   ========================================================================== */

export const PRECO_COSMETICO = 50;

export const TIPOS = {
  moldura: { nome: "Moldura de avatar", icone: "🖼️" },
  campo: { nome: "Skin de campo", icone: "🏟️" },
  verso: { nome: "Costas das cartas", icone: "🎴" },
};

// abertura: quanto da largura da moldura é o buraco onde entra o avatar
export const COSMETICOS = {
  "moldura-viking": {
    tipo: "moldura", nome: "Fúria Viking", imagem: "img/cosmeticos/moldura-viking.webp", abertura: 0.577,
    descricao: "Runas, pele de urso e machados em brasa.",
  },
  "moldura-cosmica": {
    tipo: "moldura", nome: "Coroa Cósmica", imagem: "img/cosmeticos/moldura-cosmica.webp", abertura: 0.707,
    descricao: "Ouro, rubis e um pedaço do universo.",
  },
  "moldura-dragoes": {
    tipo: "moldura", nome: "Trovão dos Dragões", imagem: "img/cosmeticos/moldura-dragoes.webp", abertura: 0.623,
    descricao: "Três dragões de olhos nada azuis e muito raio.",
  },
  "campo-arcano": {
    tipo: "campo", nome: "Templo Arcano", skin: "arcano", previa: "img/cosmeticos/campo-arcano-previa.webp",
    descricao: "O seu lado do campo vira um templo de raios roxos.",
  },
  "verso-arcano": {
    tipo: "verso", nome: "Selo Arcano", skin: "arcano", imagem: "img/cosmeticos/verso-arcano.webp",
    descricao: "O portal do templo nas costas das suas cartas.",
  },
};

export const ehCosmetico = (id) => Object.hasOwn(COSMETICOS, id);
export const precoCosmetico = (id) => (ehCosmetico(id) ? PRECO_COSMETICO : 0);
const doTipo = (id, tipo) => (ehCosmetico(id) && COSMETICOS[id].tipo === tipo ? id : null);

// O visual equipado de um perfil (ou do cartão de um jogador no duelo): só ids que existem
export function visualDe(p) {
  const v = p?.visual && typeof p.visual === "object" ? p.visual : {};
  return { moldura: doTipo(v.moldura, "moldura"), campo: doTipo(v.campo, "campo"), verso: doTipo(v.verso, "verso") };
}

// Nome da skin (para o CSS: data-skin="arcano") do campo ou das costas
export const skinDe = (id, tipo) => (doTipo(id, tipo) ? COSMETICOS[id].skin : null);

// Avatar com moldura: devolve um elemento com a mesma classe (e o mesmo tamanho) do avatar,
// o avatar um pouco menor no buraco e a moldura passando um pouco por fora, com brilho.
export function comMoldura(img, idMoldura) {
  const c = doTipo(idMoldura, "moldura") ? COSMETICOS[idMoldura] : null;
  if (!c) return img;
  const caixa = document.createElement("span");
  caixa.className = `${img.className} com-moldura`;
  caixa.dataset.moldura = idMoldura;
  caixa.style.setProperty("--abertura", c.abertura);
  caixa.style.setProperty("--mascara", `url("${new URL(c.imagem, document.baseURI).href}")`);
  img.className = "com-moldura__avatar";
  const moldura = document.createElement("img");
  moldura.className = "com-moldura__moldura";
  moldura.src = c.imagem;
  moldura.alt = "";
  moldura.decoding = "async";
  const brilho = document.createElement("span");
  brilho.className = "com-moldura__brilho";
  brilho.setAttribute("aria-hidden", "true");
  caixa.append(img, moldura, brilho);
  return caixa;
}
