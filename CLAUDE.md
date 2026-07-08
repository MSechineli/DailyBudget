# App de Controle de Gastos Diários

Contexto e decisões de arquitetura deste projeto. Leia antes de escrever código.

## O que é

App pessoal de controle de gastos com **orçamento diário rolante (saldo acumulado)**.
Cada dia você "ganha" um custo diário de budget; gastos descontam, recebimentos somam.
Se o saldo acumulado fica negativo, você está "no vermelho" — e por quantos dias
(deficit ÷ custo diário). Recebimentos extras empurram de volta pro verde.

**Custo diário = (renda do mês − custos fixos do mês) ÷ dias do mês.**

## Arquitetura (sem servidor)

- **Front 100% estático.** Nada de backend próprio. Sem Next.js, sem Vercel.
- **JSON local = fonte de verdade.** Guardado em IndexedDB. Offline-first.
- **Sync automático:** sobe o JSON pro Google Drive do próprio usuário via OAuth
  client-side (Google Identity Services), escopo `drive.file`. Sync é best-effort.
- **Export da planilha:** botão sob demanda que lê o JSON e gera um `.xlsx`. NÃO é
  sync contínuo pro Sheets — é export quando o usuário quiser.

## Stack

- **Vite** (dev server / build).
- **Alpine.js** pra reatividade (app é basicamente formulário + listas).
- **ExcelJS** pro export `.xlsx` (mantém cores/fills/freeze; SheetJS community é fraco em estilo).
- **idb-keyval** pro IndexedDB.
- **Google Identity Services** (`google.accounts.oauth2`) + **Drive REST v3** via `fetch`
  (não usar o SDK `gapi` pesado).
- **PWA** com `vite-plugin-pwa`.
- Deploy: **Cloudflare Pages** ou **GitHub Pages** (ambos servem, é estático).
- Gestos: **Pointer Events** nativo + CSS `scroll-snap` pra swipe entre meses.
  Só trazer lib de gesto (Swiper / @use-gesture) se o nativo não bastar.

## Regras inegociáveis (aprendidas na dor)

1. **Dinheiro em centavos inteiros, NUNCA float.** `19.90` → `1990`. Formata pra R$ só na exibição.
2. **Data como string `YYYY-MM-DD`, nunca `Date`/timestamp.** BR é UTC-3 e timestamp
   empurraria gastos pro dia errado. Data de calendário é texto puro.
3. **`version` no JSON desde o commit 1.** Schema muda. Função de migração no load, sempre.
4. **Saldo / status "vermelho" são DERIVADOS, nunca guardados.** Fonte de verdade =
   lançamentos crus + config. Computa on the fly na leitura.
5. **IndexedDB, não localStorage.** E chamar `navigator.storage.persist()` no primeiro
   uso, senão o browser pode limpar os dados sob pressão de storage.
6. **Escrita local é sempre garantida; sync é best-effort.** Nunca bloquear o lançamento
   esperando o Drive. Grava local → marca `dirty` → sincroniza com debounce + flush no
   `visibilitychange`. Offline lança normal, sobe quando voltar. Só sobe se o conteúdo
   mudou (compara hash) pra não gastar request à toa.
7. **Validar o JSON no load.** Se o parse falhar, cair pra última revisão boa
   (o Drive versiona o arquivo a cada `PATCH`, então dá pra recuperar).

## Modelo de dados (JSON)

```json
{
  "version": 1,
  "config": {
    "ano": 2026,
    "rendaPadraoCentavos": 400000,
    "custosFixosPadrao": [
      { "id": "fx_aluguel", "nome": "Aluguel", "valorCentavos": 120000 },
      { "id": "fx_luz", "nome": "Luz", "valorCentavos": 15000 }
    ]
  },
  "meses": {
    "2026-01": {
      "rendaOverrideCentavos": null,
      "custosFixosOverride": null
    }
  },
  "lancamentos": {
    "lanc_abc123": {
      "id": "lanc_abc123",
      "data": "2026-01-05",
      "tipo": "saida",
      "valorCentavos": 3000,
      "descricao": "mercado",
      "updatedAt": "2026-01-05T14:30:00.000Z",
      "deleted": false
    }
  },
  "sync": {
    "driveFileId": null,
    "lastSyncedHash": null
  }
}
```

### Notas do schema

- **`config`** guarda o padrão. Cada mês em **`meses`** herda esse padrão a menos que
  tenha override. `rendaOverrideCentavos: null` = usa `rendaPadraoCentavos`.
  `custosFixosOverride: null` = usa `custosFixosPadrao`; se for um array, substitui só naquele mês.
- **`lancamentos` é um map por `id`** (não array) com `updatedAt` em cada item e
  `deleted` (soft delete). Isso deixa a porta aberta pra merge item-a-item entre devices
  no futuro, sem retrabalho de schema. Por ora o sync é last-write-wins do arquivo inteiro.
- **`tipo`**: `"entrada"` (dinheiro que entra) | `"saida"` (dinheiro que sai).
  `valorCentavos` é sempre positivo; o sinal vem do `tipo`. Ver `DOMINIO.md`.
- **`sync.driveFileId`**: guardado localmente pra reencontrar o arquivo no Drive.
  No primeiro boot, se não tiver fileId, procurar por nome/`appProperties` (o escopo
  `drive.file` lista arquivos que o próprio app criou) antes de criar um novo — evita duplicata.

## Derivações (calcular, não armazenar)

**`DOMINIO.md` é a fonte de verdade das fórmulas.** Resumo, mas leia lá o detalhe
(incluindo os casos de borda e o exemplo trabalhado usado como fixture de teste):

- `diasNoMes(ano, mes)` = número de dias do mês.
- `rendaMes` = override ?? padrão.
- `totalFixosMes` = soma dos fixos (override ?? padrão).
- `sobra` = rendaMes − totalFixosMes (pode ser negativa).
- `custoDiarioMedio` = sobra / diasNoMes (float; só pra exibição e razão de dias no vermelho).
- Por dia `d` (1-indexed):
  - `budgetAcum(d)` = `round(sobra × d / diasNoMes)` — fórmula PROPORCIONAL, não
    `round(custoDiario) × d`. Evita drift; fecha exato no último dia (`budgetAcum(N) === sobra`).
  - `entradaAcum(d)` / `saidaAcum(d)` = soma de entradas/saídas com `data` até o dia d.
  - `saldo(d)` = budgetAcum(d) + entradaAcum(d) − saidaAcum(d).
  - verde se `saldo(d) >= 0`, senão vermelho.
  - `diasNoVermelho(d)` = se saldo < 0 e custoDiarioMedio > 0, `ceil(-saldo / custoDiarioMedio)`, senão 0.

Implementação pura em `src/data/domain.ts`; a ponte com o AppData (override) em `src/data/derive.ts`.

## Sync com Drive (client-side)

- OAuth via GIS token client, escopo `drive.file` (não-sensível, sem verificação chata).
- Token expira em ~1h e no fluxo client-side **não há refresh token** — reautenticar
  silencioso ou pedir de novo quando expirar. Sem sync em background com app fechado.
- Upload: primeira vez cria o arquivo (guarda `fileId`); depois
  `PATCH https://www.googleapis.com/upload/drive/v3/files/{fileId}?uploadType=media`.
- Conflito multi-device = last-write-wins do arquivo inteiro. Se virar problema real,
  usar o map por id + updatedAt pra merge (schema já preparado).

## Export xlsx (ExcelJS, sob demanda)

Reproduz o layout da planilha original:
- Uma aba por mês + aba Config + aba Resumo Anual.
- Mini-painel no topo (custo/dia, sobra, renda), colunas: Dia, Data, Gasto, Recebido,
  Saldo, Status, Budget acum., Saldo (dias).
- Formatação condicional verde/vermelho na **linha inteira** pelo saldo do dia.
- Congelar Dia+Data e o cabeçalho. Destacar a linha de "hoje".
- Valores já calculados (as derivações acima) — não depende de fórmula do Excel.

## Estilo de código

- TypeScript.
- Direto e sem over-engineering. Nada de camadas/abstração que o tamanho do problema
  (~365 lançamentos/ano) não justifica.
- Comentários e nomes podem ser em pt-BR.