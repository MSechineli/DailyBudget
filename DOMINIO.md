# Domínio — previsão financeira

Fonte de verdade da **regra de negócio**. O `CLAUDE.md` cuida de arquitetura/stack/
convenções e aponta pra cá. Matemática pura em `src/data/domain.ts`; a ponte com o
`AppData` (por carteira, a partir de "hoje") em `src/data/derive.ts`.

## O que é

App pra **prever a situação financeira futura**, não só registrar gastos. Cada carteira
("conta") tem um **Extrato** (lançamentos) e um **Diário** (painel de previsão que
recalcula a cada lançamento):

- **Saldo atual** — Σ(entradas − saídas) de tudo com data ≤ hoje.
- **Próxima renda (derivada)** — a próxima **entrada futura já cadastrada** (ex.: salário
  recorrente): a menor data > hoje entre os eventos de tipo `entrada`. Não é mais um campo.
- **Orçamento diário recomendado** — `saldo atual ÷ dias até a próxima renda`. Dinâmico:
  muda a cada gasto/recebimento.
- **Média diária de gastos** — saídas dos últimos 30 dias ÷ 30 (ritmo real).
- **Quantos dias o dinheiro dura** — `saldo ÷ média` (no ritmo atual).
- **Data prevista em que o dinheiro acaba** — hoje + dias que dura.
- **Folga / déficit** — dias que dura − dias até a renda (positivo = folga; negativo =
  falta antes da renda).
- **ISF (Índice de Segurança Financeira)** — pela quantidade de dias que o dinheiro dura.
- **Dia a dia (extrato corrido)** — de hoje pra frente, um horizonte extensível ("Ver mais
  dias", +60 por toque): cada dia mostra o **gasto/recebido registrado** (avulsos + séries
  materializadas) e o **saldo corrente**, verde enquanto positivo, vermelho quando negativo.
  Entradas futuras (ex.: salário) aparecem como saltos.

Objetivo: decidir **antes** de o dinheiro acabar.

**Estimativa × fato.** Os indicadores (orçamento, média, ISF, dias que dura, data que
acaba, folga) são *estimativas* pelo ritmo dos últimos 30 dias. O dia a dia e o gráfico são
o *saldo corrido factual* do que está cadastrado — dias sem lançamento ficam planos.

## Vocabulário

- **Carteira** (`Carteira { id, nome }`): uma conta independente. A "próxima renda" não é
  um campo — é derivada da próxima entrada futura cadastrada (ver Fórmulas).
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
proximaEntrada    = menor data > hoje entre os eventos de tipo 'entrada';  // null se não há
diasAteRenda      = proximaEntrada ? (proximaEntrada − hoje em dias) : null;
orcamentoDiario   = diasAteRenda !== null ? saldoAtual / diasAteRenda : null;
diasQueDura       = mediaDiaria > 0 ? saldoAtual / mediaDiaria : Infinity;
dataQueAcaba      = (diasQueDura finito && saldo > 0) ? hoje + ⌊diasQueDura⌋ : null;
folgaDeficitDias  = (diasAteRenda !== null && diasQueDura finito) ? ⌊diasQueDura⌋ − diasAteRenda : null;
desvio            = orcamentoDiario !== null ? mediaDiaria − orcamentoDiario : null; // + = gastando acima
```

`proximaEntrada` varre mês a mês a partir do mês de hoje (teto de 24 meses) — séries de
entrada indefinidas são achadas logo no 1º mês seguinte.

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

### Projeção (extrato corrido, dia a dia)

De hoje (dia 0) até hoje+`horizonte` (60 por padrão, +60 a cada "Ver mais dias"), o saldo
é acumulado a partir do que está **registrado** — não é uma reta pela média:

```ts
mov(dia)   = { gasto: Σ saídas registradas no dia, recebido: Σ entradas registradas no dia };
saldo(0)   = saldoAtual;                        // já inclui tudo ≤ hoje
saldo(i>0) = saldo(i-1) + recebido − gasto;     // acumula só os dias futuros
```

Cada linha mostra `Gasto | Recebido | Saldo`; o saldo é verde enquanto ≥ 0, vermelho quando
< 0. Entradas futuras (ex.: salário recorrente) aparecem como **saltos** para cima; o
gráfico é essa mesma série de saldo (linha/área verde→vermelho no cruzamento do zero).
Performático: um passe monta `mov` por data, outro acumula o saldo — O(meses + dias).

## Casos de borda

1. **Sem entrada futura cadastrada**: `proximaEntrada = null` → sem orçamento, desvio nem
   folga (a UI mostra uma dica pra cadastrar uma entrada). Saldo, média, ISF, "dias que
   dura" e o **dia a dia** (extrato corrido) continuam funcionando.
2. **Sem gastos nos últimos 30 dias**: `mediaDiaria = 0` → dura pra sempre → ISF
   Excelente, sem "data que acaba".
3. **Saldo negativo**: reflete direto no saldo atual e na projeção (começa no vermelho).
4. **Lançamentos futuros** (data > hoje): **não** entram no saldo atual (é "o que você
   tem agora"), mas entram no dia a dia como movimento/salto no dia deles; e no Extrato do
   mês deles. Uma entrada futura é a que vira a "próxima renda".
5. **Dia sem lançamento**: no dia a dia fica plano (só carrega o saldo do dia anterior).
6. **Isolamento de carteira**: saldo/previsão de uma carteira nunca dependem de outra.

## Exemplo trabalhado

Carteira com saldo atual `170000` (R$ 1.700), um salário recorrente (entrada) que cai
daqui a **22 dias**, saídas dos últimos 30 dias = `30000` (R$ 300) → média `1000/dia`.

- proximaEntrada = a data desse salário (derivada), diasAteRenda = `22`.
- orçamento/dia = `170000 / 22 ≈ 7727` (R$ 77,27).
- diasQueDura = `170000 / 1000 = 170` → ISF **Excelente**.
- dataQueAcaba = hoje + 170 dias.
- folga = `170 − 22 = 148 dias`.
- desvio = `1000 − 7727 = −6727` → gastando **bem abaixo** do recomendado.
- dia a dia: saldo parte de `170000`, cai só nos dias com gasto registrado e **salta** no
  dia do salário (ex.: `+400000`); dias sem lançamento ficam planos.

## Séries recorrentes (semântica)

- Ativa num mês se `mesInicio ≤ mk ≤ (mesFim ?? ∞)` e mesma `carteiraId`.
- Materializa um lançamento datado em `min(diaDoMes, diasNoMes)` — conta no saldo/
  previsão como qualquer lançamento com aquela data.
- **Editar "daqui pra frente" = split** (trunca a antiga em `mesAnterior(mk)`, cria uma
  nova de `mk` em diante herdando `carteiraId`/`diaDoMes`/`mesFim`). Se `mk === mesInicio`,
  edita em lugar. **Encerrar**: `mk === mesInicio` → exclui; senão → `mesFim = mesAnterior(mk)`.

## Backlog (não implementado)

Janela da média configurável / ciclo entre rendas; categorias de gasto;
transferência entre carteiras;
sync com Google Drive e export `.xlsx`; notificações PWA de risco.
