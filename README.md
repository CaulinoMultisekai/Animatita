# Animatita

Editor web para rigging e animacao 2D/3D falso de personagens a partir de uma imagem. O projeto permite importar uma textura, gerar malha, criar bones, jiggles e pins, animar com keyframes ou Lissajous, exportar o personagem em JSON e gerar um player standalone.

## Stack

- React 19
- Vite 6
- TypeScript com `allowJs`
- Tailwind CSS 4 via plugin do Vite
- Canvas 2D para renderizacao e manipulacao da malha

## Como Rodar

Requisitos:

- Node.js
- npm

Instale dependencias:

```bash
npm install
```

Rode o editor:

```bash
npm run dev
```

URL padrao:

```txt
http://localhost:3000
```

Build do app:

```bash
npm run build
```

Checagem TypeScript:

```bash
npm run lint
```

Gerar player standalone:

```bash
npm run build:player
```

Saida do player:

```txt
dist/player/animatita-player.js
dist/player/example.html
```

## Fluxo de Uso

1. Importe a textura do personagem.
2. Opcionalmente importe um depth map.
3. Ajuste a malha em `Grade Cheia` ou `Otimizada Edge`.
4. Crie bones, jiggles e pins no modo de edicao.
5. Ajuste pesos, profundidade, fisica secundaria e controles de mouse.
6. Salve poses/keyframes e configure interpolacao.
7. Use preview para testar o movimento.
8. Exporte o bundle do personagem em JSON.
9. Use o JSON exportado com o player standalone.

## Arquitetura

```txt
src/
  App.tsx                         Editor principal: UI, eventos, canvas, rig, animacao e export/import.
  main.tsx                        Entrada React.
  index.css                       Estilos globais.
  engine/
    initialEngine.ts              Estado inicial mutavel do motor.
  utils/
    math.ts                       Geometria, smoothstep, triangulacao Delaunay, cores.
    canvas.ts                     Desenho de triangulos texturizados no Canvas 2D.
  constants/
    jigglePresets.ts              Presets de jiggle.
  components/
    Pad2D.tsx                     Controle 2D para parametros X/Y.
    LissajousVisualizer.tsx       Preview visual da curva Lissajous.
  player/
    animatita-player.js           Player standalone.
    generate-player.mjs           Builder que gera dist/player.
```

## Motor

O estado do motor vive em um objeto mutavel criado por `createInitialEngine()`. Isso evita render React em cada frame e deixa o loop do Canvas controlar a simulacao.

Conceitos principais:

- `imageRect`: area util da textura/personagem no canvas.
- `verticesRest`: vertices da malha em repouso.
- `verticesCurrent`: vertices deformados no frame atual.
- `triangles`: indices da triangulacao.
- `weights`: pesos de influencia por vertex.
- `bones`: cadeia hierarquica usada para deformacao e cinemática.
- `jiggles`: areas elasticas com fisica secundaria.
- `pins`: regioes de fixacao e isolamento.
- `depthImage`: imagem usada para relevo falso 3D.
- `keyframes`: poses salvas para timeline.

## Renderizacao

O editor usa um loop com `requestAnimationFrame` dentro de `App.tsx`.

Ordem geral:

1. Redimensiona o canvas conforme o container.
2. Atualiza animacao, bones, jiggles, pins e vertices.
3. Limpa o canvas.
4. Aplica zoom e transformacao de mundo.
5. Desenha a area util do personagem.
6. Desenha triangulos texturizados ou modos de debug.
7. Desenha pins, jiggles, bones e selecao.

## Malha e Deformacao

Existem dois caminhos de malha:

- `GRID`: grade regular dentro de `imageRect`.
- `OPTIMIZED`: pontos gerados a partir de bordas/alpha da imagem e triangulados com Delaunay.

A textura e deformada por triangulos. Cada triangulo usa coordenadas de repouso para amostrar a imagem e coordenadas atuais para posicionar o resultado.

## Animacao

O editor suporta:

- poses A/B
- timeline de keyframes
- interpolacao `SMOOTH`, `LINEAR`, `EASE_IN`, `EASE_OUT`
- ping-pong
- velocidade de animacao
- Lissajous procedural em profundidade ou bones + profundidade
- rotacao/parallax pelo mouse

## Exportacao

O botao de exportacao gera um JSON com este formato geral:

```json
{
  "format": "animatita-character",
  "version": 1,
  "character": {
    "bones": [],
    "jiggles": [],
    "pins": [],
    "imageRect": {},
    "settings": {}
  },
  "animations": [],
  "currentAnimation": "default"
}
```

O player standalone carrega esse JSON junto com a imagem e, opcionalmente, um depth map.

Exemplo:

```js
import { AnimatitaPlayer } from './animatita-player.js';

const player = new AnimatitaPlayer(document.getElementById('stage'));
await player.load(characterJsonFileOrUrlOrText, imageFileOrUrl, optionalDepthFileOrUrl);
player.setAnimation('default');
player.play();
```

## Padroes do Projeto

- Preferir mudancas pequenas e localizadas.
- Manter a logica de frame no motor/canvas, nao em estado React.
- Usar React state para UI e controles, e sincronizar valores persistentes no `engine`.
- Evitar recriar a malha sem necessidade; remesh e caro.
- Ao adicionar configuracoes exportaveis, atualizar importacao, exportacao e player.
- Ao mexer em helpers compartilhados, conferir editor e `src/player/animatita-player.js`.
- Rodar `npm run lint` antes de finalizar alteracoes.
- Rodar `npm run build:player` quando alterar o player ou APIs exportadas.

## Player Standalone

`src/player/animatita-player.js` e uma versao independente do motor para uso fora do editor. O builder `src/player/generate-player.mjs` copia/gera o arquivo final em `dist/player` e exporta tambem helpers de topo usados como trechos reutilizaveis.

Quando alterar comportamento do editor que tambem precisa existir no runtime final, replique ou adapte no player.

## Variaveis de Ambiente

O Vite injeta `GEMINI_API_KEY` se existir no ambiente. Hoje o fluxo principal do editor nao depende disso para rodar localmente.

## Problemas Comuns

- Personagem fora da area: confira `imageRect` e use o retangulo de fundo do editor como referencia.
- Malha estranha: tente alternar entre `Grade Cheia` e `Otimizada Edge`, ou reduza densidade.
- Depth invertido: alterne `Inverter Depth`.
- Jiggle instavel: reduza rigidez, bouncy ou aumente amortecimento.
- Player sem atualizacao: rode `npm run build:player` depois de alterar `src/player`.
