/* ==========================================================================
   Duelo da Zoeira · js/premios.js
   Troféus e relíquias. Só um ADM consegue dar (o prêmio vai assinado e o jogo
   de todo mundo confere a assinatura antes de mostrar ou deixar usar).
   ========================================================================== */

export const PREMIOS = {
  ouro: {
    tipo: "trofeu", nome: "Troféu de Ouro", posicao: "Campeão", emoji: "🥇", ordem: 1,
    imagem: "img/premios/trofeu-ouro.webp", grande: "img/premios/trofeu-ouro-grande.webp",
    texto: "Dado só ao campeão do torneio: venceu todas as partidas da chave até a final.",
  },
  prata: {
    tipo: "trofeu", nome: "Troféu de Prata", posicao: "Vice-campeão", emoji: "🥈", ordem: 2,
    imagem: "img/premios/trofeu-prata.webp", grande: "img/premios/trofeu-prata-grande.webp",
    texto: "Dado ao vice-campeão: chegou à grande final do torneio.",
  },
  bronze: {
    tipo: "trofeu", nome: "Troféu de Bronze", posicao: "3º lugar", emoji: "🥉", ordem: 3,
    imagem: "img/premios/trofeu-bronze.webp", grande: "img/premios/trofeu-bronze-grande.webp",
    texto: "Dado ao 3º lugar: venceu a disputa de terceiro lugar do torneio.",
  },
  "careca-do-milenio": {
    tipo: "reliquia",
    nome: "Careca do Milênio",
    emoji: "🔺",
    ordem: 0,
    imagem: "img/premios/careca-do-milenio.webp",
    icone: "img/premios/careca-do-milenio-icone.webp",
    grande: "img/premios/careca-do-milenio-grande.webp",
    habilidade: "Compra do Destino",
    texto: "Compra do Destino: uma vez por duelo, na sua Fase Principal, se você tiver 4000 PV ou menos, escolha qualquer carta do seu deck e coloque-a no topo dele.",
  },
};

export const ehReliquia = (item) => PREMIOS[item]?.tipo === "reliquia";
export const ehTrofeu = (item) => PREMIOS[item]?.tipo === "trofeu";

// Relíquia "Careca do Milênio": PV máximos para usar a Compra do Destino (metade dos 8000 iniciais)
export const PV_COMPRA_DO_DESTINO = 4000;
