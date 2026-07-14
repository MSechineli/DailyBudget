# Domínio — carteiras, valor diário e saldo

Fonte de verdade da **regra de negócio**. O `CLAUDE.md` cuida de arquitetura/stack/
convenções e aponta pra cá. Funções puras e testáveis em `src/data/domain.ts`, com a
ponte pro `AppData` (por carteira) em `src/data/derive.ts`.

## O que é

App financeiro pessoal com **múltiplas carteiras** (Corrente, Investimento, Vale-
alimentação…). Cada carteira tem duas visões:

- **Extrato** — lista clássica dos lançamentos (entradas/saídas) do mês, pra adicionar,
  editar e conferir.
- **Valor diário** — orçamento diário rolante: a carteira tem um **valor diário**
  definido **manualmente** pelo usuário; o saldo acumula esse valor por dia e responde
  "quanto posso gastar hoje / na semana".

Cada carteira é **independente**: lançamentos, séries, saldo e rollover são todos por
carteira. (Sem transferência entre carteiras por enquanto.)

## Vocabulário

- **Carteira** = uma "conta" (`Carteira { id, nome, valorDiarioCentavos }`). O
  `valorDiarioCentavos` é o valor diário manual (≥ 0) — a base do orçamento.
- **Entrada** = dinheiro que ENTRA (`tipo: "entrada"`). **Saída** = dinheiro que SAI
  (`tipo: "saida"`). `valorCentavos` é sempre positivo; o sinal vem do `tipo`.
- **Lançamento avulso** = de um dia só (`data`), numa carteira (`carteiraId`).
- **Série recorrente** = repete todo mês numa janela `[mesInicio, mesFim]` (`null` =
  indefinida), numa carteira. Materializa um lançamento datado em `diaDoMes` (clampado
  ao tamanho do mês) a cada mês ativo — daí em diante é tratada como um lançamento
  normal.
- **Valor diário** = `carteira.valorDiarioCentavos`. **Sobra do mês** (base a acumular)
  = valor diário × dias do mês.
- **Saldo inicial (rollover)** = saldo final do mês anterior da carteira, herdado
  **imediato** no dia 1 do mês seguinte.
- **Saldo** = saldo do dia. Verde se ≥ 0, vermelho se < 0.

## Unidade: centavos inteiros

R$ 19,90 = `1990`. Nunca float. Formata pra R$ só na exibição.

## Modelo de cálculo (o coração — `domain.ts`, por carteira)

Três forças montam o saldo de cada dia `d` do mês:

1. **Base diluída** — o valor diário espalhado igual pelos dias:
   `taxaBase = valorDiário` (que é `sobra / diasNoMes`, com `sobra = valorDiário × dias`).
2. **Rollover imediato** — o saldo herdado do mês anterior entra **cheio** já no dia 1
   (offset constante). Positivo = você começa com ele; negativo = começa no vermelho e
   recupera com o tempo.
3. **Lançamentos** (avulsos + séries materializadas), por tipo:
   - **Entrada → diluída**: dividida pelos dias que restam do mês a partir do dia em que
     ocorreu (inclusive); soma à taxa diária dali pra frente.
   - **Saída → imediata**: bate o valor **cheio** no dia e permanece descontada.

> As séries entram aqui **materializadas** como um lançamento datado (`diaDoMes`) — uma
> entrada recorrente dilui, uma saída recorrente bate na hora, igual a um avulso.

### Fórmulas

```ts
diasNoMes = new Date(ano, mes, 0).getDate();
sobra = valorDiarioCentavos * diasNoMes;   // base do mês
taxaBase = sobra / diasNoMes;              // = valorDiário

// por dia d (1-indexed):
budgetBruto(d) = saldoInicial
               + taxaBase · d
               + Σ, por ENTRADA com diaEntrada ≤ d: (entrada / diasRestantes) · (d − diaEntrada + 1);
budgetAcum(d)  = round(budgetBruto(d));    // arredonda só aqui (saídas já são inteiras)
saidasAcum(d)  = Σ saídas com dia ≤ d;
saldo(d)       = budgetAcum(d) − saidasAcum(d);
status(d)      = saldo(d) ≥ 0 ? 'verde' : 'vermelho';

taxaDiaria(d)      = taxaBase + Σ (taxaEntrada das entradas com dia ≤ d); // recuperação
diasNoVermelho(d)  = saldo(d) < 0 && taxaDiaria(d) > 0 ? ceil(−saldo(d) / taxaDiaria(d)) : 0;
```

**Fecha exato no último dia:** `saldo(diasNoMes) = saldoInicial + sobra + Σentradas − Σsaídas`.
`domain.ts` (`calcularMes`) é intocado pela troca do modelo — só muda o que `derive.ts`
alimenta nele (a base virou o valor diário, e as séries entram materializadas).

## Derivações por carteira (`derive.ts`)

- `valorDiario(dados, carteiraId)` = `carteira.valorDiarioCentavos`.
- `resumoMesDe(dados, carteiraId, mk)` → `sobra = valorDiário × dias`.
- `eventosDoMes(dados, carteiraId, mk)` = avulsos da carteira no mês + séries ativas
  materializadas (datadas em `diaDoMes`). É o input do `calcularMes`.
- `calcularMesDe` / `agregadoMesDe` / `custoDiarioMedio` — todos recebem `carteiraId`.
- `itensDoMes(dados, carteiraId, mk)` = a lista do Extrato: avulsos + ocorrências de
  série, ordenados por data.

### Rollover contínuo (por carteira)

`saldoInicialMes(dados, carteiraId, mk)` = soma, de cada mês entre a **primeira atividade
da carteira** (menor `data` de lançamento ou `mesInicio` de série) e o mês anterior a
`mk`, de `sobra + Σentradas − Σsaídas` daquele mês. Equivale ao saldo do último dia de
cada mês anterior.

> **Nota:** o rollover é ancorado na primeira **atividade** (lançamento/série). Uma
> carteira só com valor diário e nenhum lançamento não acumula rollover entre meses
> (cada mês parte do zero e acumula o valor diário dentro dele). O rollover passa a
> valer a partir do primeiro lançamento/série.

## Casos de borda

1. **Mês curto/longo.** `diasNoMes` resolve; array vai só até `diasNoMes`.
2. **Valor diário 0.** `taxaBase = 0`: sem lançamentos, todo dia fica em 0 (verde). Um
   gasto fica vermelho e **não recupera** (taxa 0) — `diasNoVermelho = 0`.
3. **valorCentavos ≤ 0.** Rejeitado na validação; o sinal é o `tipo`.
4. **Saldo 0.** É **verde** (`≥ 0`).
5. **Data fora do mês.** Ignorada.
6. **`deleted: true`.** Ignorado (fica no JSON pro merge futuro).
7. **"Hoje".** `dia.data === hojeISO()` destaca a linha; fora do mês, "posso gastar hoje"
   mostra "—".
8. **Rollover.** `saldoInicial` do mês N = saldo do último dia do mês N-1 (recursivo).
   Pode ser negativo — entra imediato no dia 1, sem clamping.
9. **Gasto grande demais.** Fica vermelho e só recupera pelo tempo (taxaBase) ou por uma
   entrada — não some sozinho.
10. **Isolamento de carteira.** Lançamentos/séries de uma carteira nunca afetam o saldo
    de outra.

## Exemplo trabalhado (fixture de teste)

Carteira "Corrente", **valor diário R$ 100,00 = `10000`**, mês de 30 dias → sobra 300000.
Rollover 0. Avulsos: saída `25000` no dia 1; entrada `15000` no dia 3; saída `5000` no dia 4.

| dia | entradaDia | saidaDia | saldo   | status   |
|-----|-----------:|---------:|--------:|----------|
| 1   | 0          | 25000    | −15000  | vermelho |
| 2   | 0          | 0        | −5000   | vermelho |
| 3   | 15000      | 0        | 5536    | verde    |
| 4   | 0          | 5000     | 11071   | verde    |
| 30  | 0          | 0        | 285000  | verde    |

A saída de R$ 250 no dia 1 bate cheia contra o budget de R$ 100 → −R$ 150; o valor
diário recupera sozinho (verde no dia 3). A entrada de R$ 150 dilui pelos dias
restantes. Dia 30 fecha em `300000 + 15000 − 30000 = 285000`.

## Séries recorrentes (semântica)

- Ativa num mês `mk` se `mesInicio ≤ mk ≤ (mesFim ?? ∞)` e mesma `carteiraId`.
- Materializa um lançamento datado em `min(diaDoMes, diasNoMes)`.
- **Editar "daqui pra frente" = split**: trunca em `mesAnterior(mk)` e cria uma nova a
  partir de `mk` (herda `carteiraId`/`diaDoMes`/`mesFim`). Se `mk === mesInicio`, edita
  em lugar. **Encerrar**: `mk === mesInicio` → exclui; senão → `mesFim = mesAnterior(mk)`.

## Backlog (não implementado)

Transferência entre carteiras; rollover do valor diário sem depender de atividade;
categorias de gasto + totais; projeção de fim de mês; recorrência com valor variável por
mês; sync com Google Drive e export `.xlsx`; notificações PWA.
