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

// Prêmios tirados (testes, entregas repetidas). Como o perfil de cada jogador junta tudo o que
// ele já recebeu, apagar a mensagem do servidor não basta: o jogo de todo mundo ignora estes
// ids e o perfil do dono se limpa sozinho na próxima vez que ele entrar.
const REMOVIDOS = new Set([
  // MenonFIRE: ouro e relíquia repetidos dos torneios de teste "Copa teste" e "copa teste 2"
  "0pdoh3okvhjf", "1swn1n019yyz", "6l8m690k0vl7", "qojh1hh3opvt",
  // MenonICE: pratas dos mesmos torneios de teste
  "v9drrh0mb6p4", "5jqq6utuymwt",
]);
export const premioRemovido = (id) => REMOVIDOS.has(id);

export const ehReliquia = (item) => PREMIOS[item]?.tipo === "reliquia";
export const ehTrofeu = (item) => PREMIOS[item]?.tipo === "trofeu";

// Relíquia "Careca do Milênio": PV máximos para usar a Compra do Destino (metade dos 8000 iniciais)
export const PV_COMPRA_DO_DESTINO = 4000;
