# Domínio — previsão financeira

Fonte de verdade da **regra de negócio**. O `CLAUDE.md` cuida de arquitetura/stack/
convenções e aponta pra cá. Matemática pura em `src/data/domain.ts`; a ponte com o
`AppData` (por carteira, a partir de "hoje") em `src/data/derive.ts`.

## O que é

App pra **prever a situação financeira futura**, não só registrar gastos. Cada carteira
("conta") tem um **Extrato** (lançamentos) e um **Diário** (painel de previsão que
recalcula a cada lançamento):

- **Saldo atual** — Σ(entradas − saídas) de tudo com data ≤ hoje.
- **Orçamento diário recomendado** — `saldo atual ÷ dias até a próxima renda`. Dinâmico:
  muda a cada gasto/recebimento.
- **Média diária de gastos** — saídas dos últimos 30 dias ÷ 30 (ritmo real).
- **Quantos dias o dinheiro dura** — `saldo ÷ média` (no ritmo atual).
- **Data prevista em que o dinheiro acaba** — hoje + dias que dura.
- **Folga / déficit** — dias que dura − dias até a renda (positivo = folga; negativo =
  falta antes da renda).
- **ISF (Índice de Segurança Financeira)** — pela quantidade de dias que o dinheiro dura.
- **Projeção verde/vermelho dia a dia** — de hoje até a próxima renda, o saldo caindo:
  verde enquanto positivo, vermelho quando zeraria.

Objetivo: decidir **antes** de o dinheiro acabar.

## Vocabulário

- **Carteira** (`Carteira { id, nome, proximaRenda }`): uma conta independente. A
  `proximaRenda` é uma **data informada pelo usuário** (`YYYY-MM-DD` ou `null`) — o
  horizonte do orçamento e da projeção.
- **Entrada / Saída**: dinheiro que entra / sai. `valorCentavos` sempre positivo; o
  sinal vem do `tipo`.
- **Lançamento avulso** (de um dia) e **série recorrente** (repete todo mês numa janela,
  materializada num lançamento datado em `diaDoMes`), ambos por carteira.

## Unidade: centavos inteiros

R$ 19,90 = `1990`. Nunca float. Formata pra R$ só na exibição. Datas são string
`YYYY-MM-DD` (regra do projeto), nunca `Date`/timestamp de calendário.

## Fórmulas (por carteira, "a partir de hoje")

```ts
saldoAtual        = Σ(entradas − saídas) com data ≤ hoje;   // inclui séries materializadas
mediaDiaria       = Σ(saídas em [hoje−29, hoje]) / 30;      // ritmo dos últimos 30 dias
diasAteRenda      = proximaRenda ? (proximaRenda − hoje em dias) : null;  // null se passou/não há
orcamentoDiario   = diasAteRenda !== null ? saldoAtual / diasAteRenda : null;
diasQueDura       = mediaDiaria > 0 ? saldoAtual / mediaDiaria : Infinity;
dataQueAcaba      = (diasQueDura finito && saldo > 0) ? hoje + ⌊diasQueDura⌋ : null;
folgaDeficitDias  = (diasAteRenda !== null && diasQueDura finito) ? ⌊diasQueDura⌋ − diasAteRenda : null;
desvio            = orcamentoDiario !== null ? mediaDiaria − orcamentoDiario : null; // + = gastando acima
```

### ISF (Índice de Segurança Financeira)

Pela quantidade de dias que o dinheiro dura (`diasQueDura`):

| dias      | nível       |
|-----------|-------------|
| 45+       | Excelente   |
| 30–44     | Seguro      |
| 20–29     | Atenção     |
| 10–19     | Crítico     |
| 0–9       | Emergência  |

`Infinity` (sem gastos nos últimos 30 dias) → Excelente.

### Projeção (duas linhas + dia a dia)

Do dia 0 (hoje) ao dia `diasAteRenda`:

- **Ritmo real** — `saldo(i) = saldoAtual − mediaDiaria · i`. Verde enquanto ≥ 0,
  vermelho quando < 0 (é a "data que o dinheiro acaba" no gráfico e a tabela dia a dia).
- **Orçamento recomendado** — `saldo(i) = saldoAtual − orcamentoDiario · i`, que fecha
  **exatamente em 0** no dia da renda. É a linha de referência (tracejada) do quanto dá
  pra gastar por dia pra durar até lá.

Cada valor é arredondado por dia (o ritmo pode ser float).

## Casos de borda

1. **Sem próxima renda** (`proximaRenda` null ou já passou): sem orçamento, sem folga,
   sem projeção (a UI mostra um CTA pra informar a data). Saldo, média, ISF e "dias que
   dura" ainda funcionam.
2. **Sem gastos nos últimos 30 dias**: `mediaDiaria = 0` → dura pra sempre → ISF
   Excelente, sem "data que acaba".
3. **Saldo negativo**: reflete direto no saldo atual e na projeção (começa no vermelho).
4. **Lançamentos futuros** (data > hoje): **não** entram no saldo atual (é "o que você
   tem agora"); aparecem no Extrato do mês deles.
5. **Isolamento de carteira**: saldo/previsão de uma carteira nunca dependem de outra.

## Exemplo trabalhado

Carteira com saldo atual `170000` (R$ 1.700), próxima renda em **22 dias**, saídas dos
últimos 30 dias = `30000` (R$ 300) → média `1000/dia`.

- orçamento/dia = `170000 / 22 ≈ 7727` (R$ 77,27).
- diasQueDura = `170000 / 1000 = 170` → ISF **Excelente**.
- dataQueAcaba = hoje + 170 dias.
- folga = `170 − 22 = 148 dias`.
- desvio = `1000 − 7727 = −6727` → gastando **bem abaixo** do recomendado.
- projeção: linha real quase plana (dura muito além da renda); linha do orçamento cai
  de `170000` até `0` no dia 22.

## Séries recorrentes (semântica)

- Ativa num mês se `mesInicio ≤ mk ≤ (mesFim ?? ∞)` e mesma `carteiraId`.
- Materializa um lançamento datado em `min(diaDoMes, diasNoMes)` — conta no saldo/
  previsão como qualquer lançamento com aquela data.
- **Editar "daqui pra frente" = split** (trunca a antiga em `mesAnterior(mk)`, cria uma
  nova de `mk` em diante herdando `carteiraId`/`diaDoMes`/`mesFim`). Se `mk === mesInicio`,
  edita em lugar. **Encerrar**: `mk === mesInicio` → exclui; senão → `mesFim = mesAnterior(mk)`.

## Backlog (não implementado)

Renda derivada de uma entrada recorrente (em vez de data manual); incorporar lançamentos
futuros conhecidos na projeção (degraus, não só linha reta); janela da média
configurável / ciclo entre rendas; categorias de gasto; transferência entre carteiras;
sync com Google Drive e export `.xlsx`; notificações PWA de risco.
