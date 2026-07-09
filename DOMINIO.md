# Domínio — o que o app é e como o saldo é calculado

Fonte de verdade da **regra de negócio**. O `CLAUDE.md` cuida de arquitetura/stack/
convenções e aponta pra cá. Todas as funções descritas aqui são **puras e testáveis**
(sem I/O, sem estado global) — implementadas em `src/data/domain.ts`, com a ponte pro
`AppData` em `src/data/derive.ts`.

## O que é

App pessoal de **orçamento diário rolante**. A ideia central: você tem um valor que
"pode gastar por dia", e o saldo acumula esse valor conforme os dias passam. A pergunta
que o app responde é **"quanto posso gastar hoje / nesta semana"** sem furar o
orçamento.

- **Receitas − custos fixos recorrentes = sobra do mês.** A sobra dividida pelos dias
  = **custo diário** (o quanto você ganha de budget por dia).
- **Gasto (saída) desconta na hora**: bate cheio no dia em que aconteceu e te deixa
  "pra trás"; o budget diário te recupera com o passar dos dias.
- **Recebimento avulso (entrada) é diluído**: vira budget diário extra espalhado pelos
  dias que restam do mês.
- **Vermelho** = saldo negativo. Você volta pro verde conforme o budget acumula (ou na
  hora, se entrar dinheiro).

## Vocabulário

- **Entrada** = dinheiro que ENTRA (recebimento, freela, reembolso). `tipo: "entrada"`.
- **Saída** = dinheiro que SAI (gasto, despesa). `tipo: "saida"`.
- **Série recorrente** = lançamento que se repete todo mês numa janela `[mesInicio,
  mesFim]` (`mesFim: null` = indefinida). Salário e custos fixos são séries. Entram na
  **sobra do mês** (diluídos igual pelos dias — é o "custo diário").
- **Lançamento avulso** = lançamento de um dia só (`data` exata). Entrada avulsa dilui;
  saída avulsa bate na hora.
- **Sobra** = receitas recorrentes − custos fixos recorrentes do mês (pode ser negativa).
- **Custo diário** = sobra ÷ dias do mês.
- **Saldo inicial (rollover)** = saldo final do mês anterior, herdado **imediato** no
  dia 1 do mês seguinte.
- **Saldo** = saldo do dia (budget acumulado − saídas). Verde se ≥ 0, vermelho se < 0.
- **Dias no vermelho** = quão fundo no vermelho, medido em dias na taxa de recuperação
  atual (deficit ÷ taxa diária).

## Unidade: centavos inteiros

Todo valor monetário é **inteiro em centavos**. R$ 19,90 = `1990`. Nunca float.
`valorCentavos` é **sempre positivo** — o sinal (entra/sai) vem do `tipo`. Formata pra
R$ só na exibição.

## Modelo de cálculo (o coração)

Três forças montam o saldo de cada dia `d` do mês:

1. **Base diluída** — a sobra do mês espalhada igual pelos dias:
   `taxaBase = sobra / diasNoMes`; acumulado até `d` = `taxaBase · d`.
2. **Rollover imediato** — o saldo herdado do mês anterior entra **cheio** já no dia 1
   (offset constante somado a todos os dias). Positivo = você começa com ele; negativo
   = começa no vermelho e recupera com o tempo.
3. **Lançamentos avulsos**, com regras **diferentes** por tipo:
   - **Entrada → diluída**: seu valor é dividido pelos dias que restam do mês a partir
     do dia em que aconteceu (inclusive) e soma à taxa diária dali pra frente.
     `taxaEntrada = entrada / diasRestantes`, com `diasRestantes = diasNoMes − dia + 1`.
   - **Saída → imediata**: bate o valor **cheio** no dia em que ocorreu e permanece
     descontada dali pra frente. Não é diluída.

> **Por que a assimetria?** Uma saída é dinheiro que você **já gastou** — some agora,
> e você se recupera ganhando budget dia a dia. Uma entrada é dinheiro que você vai
> **distribuir** pelo resto do mês — vira mais budget por dia, não um pico de gasto
> permitido de uma vez. Custos fixos recorrentes (aluguel, etc.) entram pela sobra e
> são diluídos por igual — isso é intencional, eles reduzem seu custo diário.

### Fórmulas (na ordem)

```ts
// 1. dias do mês (mes 1-12). dia 0 do mês seguinte = último dia do atual.
diasNoMes = new Date(ano, mes, 0).getDate();

// 2. base
sobra = receitasRecorrentes − custosFixosRecorrentes; // pode ser negativa
taxaBase = sobra / diasNoMes;                          // custo diário (float)

// 3. por dia d (1-indexed):
//    budget acumulado = rollover (imediato) + base diluída + entradas diluídas ativas
budgetBruto(d) = saldoInicial
               + taxaBase · d
               + Σ, para cada ENTRADA com diaEntrada ≤ d:
                   (entrada / diasRestantesEntrada) · (d − diaEntrada + 1);
budgetAcum(d)  = round(budgetBruto(d)); // arredonda só aqui (saídas já são inteiras)

//    saídas batem cheias e acumulam
saidasAcum(d)  = Σ saídas com dia ≤ d;

saldo(d)  = budgetAcum(d) − saidasAcum(d);
status(d) = saldo(d) ≥ 0 ? 'verde' : 'vermelho';

// 4. dias no vermelho: taxa de RECUPERAÇÃO (base + entradas diluídas ativas);
//    saídas são one-time, não entram na taxa.
taxaDiaria(d) = taxaBase + Σ (taxaEntrada das entradas com dia ≤ d);
diasNoVermelho(d) = saldo(d) < 0 && taxaDiaria(d) > 0
  ? ceil(−saldo(d) / taxaDiaria(d)) : 0;
```

**Fecha exato no último dia:** cada entrada diluída acumula seu valor cheio até o dia
`diasNoMes`, então `saldo(diasNoMes) = saldoInicial + sobra + Σentradas − Σsaídas` —
bate com a soma crua, não importa quando os lançamentos aconteceram.

**Arredondamento sem drift:** só o `budgetBruto` (float) é arredondado, uma vez por dia.
Saídas e rollover já são inteiros. Garante que o último dia fecha exato.

## Algoritmo (referência)

Ver `calcularMes` em `src/data/domain.ts` — filtra lançamentos do mês (ignora
deletados e datas fora do mês), monta os eventos de entrada (diluídos) e varre dia a
dia acumulando saídas cheias. Complexidade `O(diasNoMes × entradas)`, trivial pro
tamanho do problema.

## Casos de borda (trate todos)

1. **Mês curto (fev) / longo.** `diasNoMes` resolve; nunca hardcode 30/31. O array vai
   só até `diasNoMes`.
2. **Dia sem lançamento.** Saldo continua subindo pela `taxaBase` (recuperação natural).
3. **Sobra negativa (fixos ≥ receitas), sem avulsos.** `taxaBase ≤ 0`: tudo vermelho
   desde o dia 1, `diasNoVermelho = 0` (razão não faz sentido). A UI mostra aviso
   "custos fixos ≥ salário".
4. **valorCentavos ≤ 0.** Rejeitado na entrada de dados; o sinal é o `tipo`.
5. **Saldo exatamente 0.** É **verde** (regra é `≥ 0`).
6. **Data fora do mês.** Ignorada.
7. **Lançamento `deleted: true`.** Ignorado (fica no JSON pro merge futuro).
8. **"Hoje".** `dia.data === hojeISO()` destaca a linha; fora do mês exibido, sem
   destaque (e "posso gastar hoje" mostra "—").
9. **Rollover.** `saldoInicial` do mês N = `saldo` do último dia do mês N−1 (que já
   inclui o rollover DELE, recursivamente). Sem mês anterior com atividade, é 0. Pode
   ser negativo — entra imediato no dia 1, sem clamping.
10. **Saída grande demais.** Uma saída maior que o budget acumulado deixa o saldo
    vermelho e ele **só recupera pelo tempo** (taxaBase) ou por uma entrada — não some
    sozinha.
11. **Mesmo dia, entrada e saída.** A saída bate cheia; a entrada começa a diluir. São
    tratadas separadamente (não se combinam num líquido).

## Exemplo trabalhado (fixture de teste)

Salário R$ 4.000,00; custo fixo R$ 1.000,00 → **sobra R$ 3.000,00 = `300000`**; mês de
**30 dias** → custo diário `10000`. Rollover 0.

Avulsos: saída `25000` no dia 1; entrada `15000` no dia 3; saída `5000` no dia 4.

| dia | entradaDia | saidaDia | saldo   | status   | diasNoVermelho |
|-----|-----------:|---------:|--------:|----------|---------------:|
| 1   | 0          | 25000    | −15000  | vermelho | 2              |
| 2   | 0          | 0        | −5000   | vermelho | 1              |
| 3   | 15000      | 0        | 5536    | verde    | 0              |
| 4   | 0          | 5000     | 11071   | verde    | 0              |
| 30  | 0          | 0        | 285000  | verde    | 0              |

Leitura: a saída de R$ 250 no dia 1 bate **cheia** contra o budget de R$ 100 → −R$ 150
(2 dias no vermelho). O budget diário recupera sozinho: dia 2 −R$ 50, dia 3 já verde. A
entrada de R$ 150 no dia 3 é diluída (mal aparece no dia 3, soma até fechar R$ 150 no
fim). Dia 30 fecha exato: `300000 + 15000 − 30000 = 285000`.

### Contra-exemplo (saída não some pelo tempo)

Sobra `300000`/30, saída `310000` no dia 1: saldo(1) = `10000 − 310000 = −300000`,
vermelho, `diasNoVermelho = 30`. Sem uma entrada, fica vermelho **piorando/estável** —
só uma entrada (ex.: `200000` no dia 15, diluída em 16 dias) recalcula a taxa e traz de
volta. Fecha em `300000 − 310000 + 200000 = 190000`.

## Rollover contínuo (`derive.ts`)

`domain.ts` não sabe de "mês anterior" — recebe `saldoInicialCentavos` pronto.
`saldoInicialMes(dados, mk)` soma `sobra + entradas avulsas − saídas avulsas` de todo
mês entre o **mês mais antigo com atividade** (menor `data` de lançamento ou `mesInicio`
de série) e o mês anterior a `mk`, inclusive — o que equivale ao saldo do último dia de
cada mês anterior. Recalculado on the fly a cada leitura (nada gravado).

## Derivações "quanto posso gastar" (features da UI)

- **Posso gastar hoje** = `saldo` do dia de hoje (o cushion disponível agora). "—" se o
  mês exibido não é o de hoje.
- **Por dia** = `custoDiarioMedio = sobra / diasNoMes` (arredondado).
- **Por semana** = custo diário × 7.
- **Gráfico do mês** = a série de `saldo` por dia (de `calcularMesDe`), desenhada como
  SVG: verde acima do zero, vermelho abaixo, com marca do dia de hoje.

## Séries recorrentes (semântica)

- Uma série vale num mês `mk` se `mesInicio ≤ mk ≤ (mesFim ?? ∞)`.
- `rendaMes` = soma das séries de entrada ativas; `totalFixosMes` = soma das de saída.
- **Editar "daqui pra frente" = split**: trunca a série em `mesAnterior(mk)` e cria uma
  nova a partir de `mk` com os valores novos (herda o `mesFim` original). Se `mk` é o
  próprio `mesInicio`, edita em lugar. **Encerrar**: `mk === mesInicio` → exclui; senão
  → `mesFim = mesAnterior(mk)`. O passado nunca é tocado.

## Resumo anual (derivado)

Por mês, de `calcularMes`: total entradas (Σ `entradasCentavos`), total saídas (Σ
`saidasCentavos`), **saldo final** = `saldo` do último dia, dias no vermelho = contagem
de dias `vermelho`.

## Backlog (ideias, não implementado)

Categorias nas saídas + totais por categoria; projeção de fim de mês ("mantendo o
ritmo, termina com R$ X"); recorrência com dia fixo (aluguel todo dia 5); sync com
Google Drive e export `.xlsx` (previstos na arquitetura); notificações PWA.
