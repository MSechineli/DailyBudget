# App de Controle de Gastos Diários

Contexto e decisões de arquitetura deste projeto. Leia antes de escrever código.

## O que é

App financeiro pessoal com **múltiplas carteiras** (Corrente, Investimento, Vale-
alimentação…). Cada carteira tem duas visões: **Extrato** (lista clássica de lançamentos)
e **Valor diário** (orçamento diário rolante). O valor diário é **definido manualmente**
por carteira; o saldo acumula esse valor por dia, gastos descontam na hora, recebimentos
diluem, e o saldo rola de um mês pro outro. Carteiras são independentes (saldo/rollover
por carteira). UI mobile-first (barra inferior de abas).

**A regra de negócio (valor diário, fórmulas de saldo, séries recorrentes, rollover,
"posso gastar") vive em `DOMINIO.md` — leia lá antes de mexer em `domain.ts`/`derive.ts`.**
Este arquivo é só arquitetura, stack e convenções.

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
  "version": 5,
  "config": { "ano": 2026 },
  "carteiras": {
    "cart_corrente": {
      "id": "cart_corrente",
      "nome": "Corrente",
      "valorDiarioCentavos": 8000,
      "updatedAt": "2026-01-01T00:00:00.000Z",
      "deleted": false
    }
  },
  "series": {
    "serie_salario": {
      "id": "serie_salario",
      "carteiraId": "cart_corrente",
      "tipo": "entrada",
      "valorCentavos": 400000,
      "descricao": "Salário",
      "diaDoMes": 5,
      "mesInicio": "2026-01",
      "mesFim": null,
      "updatedAt": "2026-01-01T00:00:00.000Z",
      "deleted": false
    }
  },
  "lancamentos": {
    "lanc_abc123": {
      "id": "lanc_abc123",
      "carteiraId": "cart_corrente",
      "data": "2026-01-05",
      "tipo": "saida",
      "valorCentavos": 3000,
      "descricao": "mercado",
      "updatedAt": "2026-01-05T14:30:00.000Z",
      "deleted": false
    }
  },
  "sync": { "driveFileId": null, "lastSyncedHash": null }
}
```

### Notas do schema

- **`carteiras`** é um map por `id`. Cada carteira tem `nome` e `valorDiarioCentavos`
  (o valor diário MANUAL, ≥ 0, base do orçamento). Sempre existe ao menos uma. `config`
  guarda só o que é app-wide (`ano`).
- **`carteiraId`** em `Lancamento` e `SerieRecorrente`: a carteira dona. Carteiras são
  independentes (saldo/rollover por carteira; sem transferência por enquanto).
- **`series` é um map por `id`.** `mesInicio`/`mesFim` (`"YYYY-MM"`, inclusive; `null` =
  indefinida) + `diaDoMes` (1–31): a série materializa um lançamento datado nesse dia a
  cada mês ativo. Semântica (ativa no mês, split ao editar "daqui pra frente", encerrar)
  em `DOMINIO.md`.
- **`lancamentos` é um map por `id`** (não array), só avulsos (de um dia só). `updatedAt`
  + `deleted` (soft delete) por item — porta aberta pra merge item-a-item no futuro. Por
  ora o sync é last-write-wins do arquivo inteiro.
- **`tipo`** (`Lancamento`/`SerieRecorrente`): `"entrada"` | `"saida"`. `valorCentavos`
  sempre positivo; o sinal vem do `tipo`. Ver `DOMINIO.md`.
- **`sync.driveFileId`**: guardado localmente pra reencontrar o arquivo no Drive.
  No primeiro boot, se não tiver fileId, procurar por nome/`appProperties` (o escopo
  `drive.file` lista arquivos que o próprio app criou) antes de criar um novo — evita duplicata.

## Derivações (calcular, não armazenar)

Saldo, status verde/vermelho, rollover e "posso gastar" são **todos derivados** on the
fly da fonte de verdade (carteiras + lançamentos + séries), por carteira — nunca
guardados (regra 4). As fórmulas, casos de borda e exemplos trabalhados (fixtures de
teste) estão em **`DOMINIO.md`**. Implementação pura em `src/data/domain.ts`; a ponte com
o `AppData` (valor diário da carteira, séries materializadas, rollover) em
`src/data/derive.ts`.

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