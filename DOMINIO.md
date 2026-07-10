# Domínio — o que o app é e como o saldo é calculado

Fonte de verdade da **regra de negócio**. O `CLAUDE.md` cuida de arquitetura/stack/
convenções e aponta pra cá. Todas as funções descritas aqui são **puras e testáveis**
(sem I/O, sem estado global) — implementadas em `src/data/domain.ts`, com a ponte pro
`AppData` em `src/data/derive.ts`.

## O que é

App pessoal pra organizar **o dinheiro que sobra depois das contas do mês**. As contas
(aluguel, cartão, luz…) são descontadas da renda logo de cara → **sobra livre**; só a
sobra livre vira o "quanto posso gastar por dia", que acumula conforme os dias passam. A
pergunta que o app responde é **"quanto posso gastar hoje / nesta semana"** sem furar o
que sobrou depois das contas.

- **Renda − contas do mês = sobra livre.** A sobra livre dividida pelos dias = **custo
  diário** (o quanto você ganha de budget por dia).
- **Conta do mês** (fixa ou variável) **debita do bolo**: entra na sobra livre, aparece
  como débito na lista, mas **não** vira evento diário nem te deixa no vermelho — é uma
  obrigação esperada, já pré-descontada.
- **Gasto do dia (saída discricionária) desconta na hora**: bate cheio no dia em que
  aconteceu e te deixa "pra trás"; o budget diário te recupera com o passar dos dias.
- **Recebimento avulso (entrada) é diluído**: vira budget diário extra espalhado pelos
  dias que restam do mês.
- **Vermelho** = saldo negativo. Você volta pro verde conforme o budget acumula (ou na
  hora, se entrar dinheiro).

## Vocabulário

- **Entrada** = dinheiro que ENTRA (recebimento, freela, reembolso). `tipo: "entrada"`.
- **Saída** = dinheiro que SAI. Toda saída avulsa tem uma **`categoria`**:
  - **Conta** (`categoria: "conta"`) = conta do mês (aluguel, cartão, luz). Debita do
    bolo → entra na sobra livre; não vira evento diário nem fica vermelho.
  - **Gasto** (`categoria: "gasto"`) = gasto discricionário do dia a dia. Débito
    imediato no dia; pode ficar vermelho.
- **Série recorrente** = lançamento que se repete todo mês numa janela `[mesInicio,
  mesFim]` (`mesFim: null` = indefinida). Salário = série de entrada (renda). Série de
  saída = **conta fixa** (é sempre uma conta, entra na sobra livre).
- **Lançamento avulso** = lançamento de um dia só (`data` exata). Entrada avulsa dilui;
  saída avulsa é conta (do bolo) ou gasto (imediato), conforme a `categoria`.
- **Contas do mês** = séries de saída ativas + saídas avulsas `conta` do mês.
- **Sobra livre** = renda − contas do mês (pode ser negativa).
- **Custo diário** = sobra livre ÷ dias do mês.
- **Saldo inicial (rollover)** = saldo final do mês anterior, herdado **imediato** no
  dia 1 do mês seguinte.
- **Saldo** = saldo do dia (budget acumulado − gastos). Verde se ≥ 0, vermelho se < 0.
- **Dias no vermelho** = quão fundo no vermelho, medido em dias na taxa de recuperação
  atual (deficit ÷ taxa diária).

## Unidade: centavos inteiros

Todo valor monetário é **inteiro em centavos**. R$ 19,90 = `1990`. Nunca float.
`valorCentavos` é **sempre positivo** — o sinal (entra/sai) vem do `tipo`. Formata pra
R$ só na exibição.

## Modelo de cálculo (o coração)

**As contas do mês não entram aqui** — elas já foram descontadas da renda pra formar a
`sobra` livre (ver `derive.ts`). O `domain.ts` só recebe a sobra livre + os eventos
diários (entradas e gastos). Três forças montam o saldo de cada dia `d`:

1. **Base diluída** — a sobra livre do mês espalhada igual pelos dias:
   `taxaBase = sobra / diasNoMes`; acumulado até `d` = `taxaBase · d`.
2. **Rollover imediato** — o saldo herdado do mês anterior entra **cheio** já no dia 1
   (offset constante somado a todos os dias). Positivo = você começa com ele; negativo
   = começa no vermelho e recupera com o tempo.
3. **Eventos diários** (só entradas avulsas e gastos avulsos — contas ficam de fora):
   - **Entrada → diluída**: seu valor é dividido pelos dias que restam do mês a partir
     do dia em que aconteceu (inclusive) e soma à taxa diária dali pra frente.
     `taxaEntrada = entrada / diasRestantes`, com `diasRestantes = diasNoMes − dia + 1`.
   - **Gasto → imediato**: bate o valor **cheio** no dia em que ocorreu e permanece
     descontado dali pra frente. Não é diluído.

> **Por que a assimetria?** Um gasto é dinheiro que você **já gastou** — some agora, e
> você se recupera ganhando budget dia a dia. Uma entrada você vai **distribuir** pelo
> resto do mês — vira mais budget por dia. E uma **conta** é obrigação esperada: entra
> pela sobra livre (diluída por igual, pré-descontada), então nunca aparece como um
> tombo no saldo nem te joga no vermelho. Séries de saída (aluguel etc.) são contas
> fixas — mesmo tratamento.

### Fórmulas (na ordem)

```ts
// 1. dias do mês (mes 1-12). dia 0 do mês seguinte = último dia do atual.
diasNoMes = new Date(ano, mes, 0).getDate();

// 2. base (sobra LIVRE = renda − contas do mês; ver derive.ts)
sobra = renda − contasDoMes;   // contas = séries de saída + saídas avulsas 'conta'
taxaBase = sobra / diasNoMes;  // custo diário (float)

// 3. por dia d (1-indexed):
//    budget acumulado = rollover (imediato) + base diluída + entradas diluídas ativas
budgetBruto(d) = saldoInicial
               + taxaBase · d
               + Σ, para cada ENTRADA com diaEntrada ≤ d:
                   (entrada / diasRestantesEntrada) · (d − diaEntrada + 1);
budgetAcum(d)  = round(budgetBruto(d)); // arredonda só aqui (gastos já são inteiros)

//    gastos (saídas avulsas 'gasto') batem cheios e acumulam; contas NÃO entram aqui
gastosAcum(d)  = Σ gastos com dia ≤ d;

saldo(d)  = budgetAcum(d) − gastosAcum(d);
status(d) = saldo(d) ≥ 0 ? 'verde' : 'vermelho';

// 4. dias no vermelho: taxa de RECUPERAÇÃO (base + entradas diluídas ativas);
//    gastos são one-time, não entram na taxa.
taxaDiaria(d) = taxaBase + Σ (taxaEntrada das entradas com dia ≤ d);
diasNoVermelho(d) = saldo(d) < 0 && taxaDiaria(d) > 0
  ? ceil(−saldo(d) / taxaDiaria(d)) : 0;
```

**Fecha exato no último dia:** cada entrada diluída acumula seu valor cheio até o dia
`diasNoMes`, então `saldo(diasNoMes) = saldoInicial + sobra + Σentradas − Σgastos` (as
contas já estão dentro da `sobra`) — bate com a soma crua.

**Arredondamento sem drift:** só o `budgetBruto` (float) é arredondado, uma vez por dia.
Saídas e rollover já são inteiros. Garante que o último dia fecha exato.

## Algoritmo (referência)

Ver `calcularMes` em `src/data/domain.ts` — recebe só os eventos diários (entradas +
gastos; as contas já entraram pela sobra via `derive.ts`), monta os eventos de entrada
(diluídos) e varre dia a dia acumulando gastos cheios. Complexidade `O(diasNoMes ×
entradas)`, trivial pro tamanho do problema.

## Casos de borda (trate todos)

1. **Mês curto (fev) / longo.** `diasNoMes` resolve; nunca hardcode 30/31. O array vai
   só até `diasNoMes`.
2. **Dia sem lançamento.** Saldo continua subindo pela `taxaBase` (recuperação natural).
3. **Sobra livre negativa (contas ≥ renda), sem avulsos.** `taxaBase ≤ 0`: tudo vermelho
   desde o dia 1, `diasNoVermelho = 0` (razão não faz sentido). A UI mostra a sobra
   livre em vermelho.
4. **valorCentavos ≤ 0.** Rejeitado na entrada de dados; o sinal é o `tipo`.
5. **Saldo exatamente 0.** É **verde** (regra é `≥ 0`).
6. **Data fora do mês.** Ignorada.
7. **Lançamento `deleted: true`.** Ignorado (fica no JSON pro merge futuro).
8. **"Hoje".** `dia.data === hojeISO()` destaca a linha; fora do mês exibido, sem
   destaque (e "posso gastar hoje" mostra "—").
9. **Rollover.** `saldoInicial` do mês N = `saldo` do último dia do mês N−1 (que já
   inclui o rollover DELE, recursivamente). Sem mês anterior com atividade, é 0. Pode
   ser negativo — entra imediato no dia 1, sem clamping.
10. **Gasto grande demais.** Um gasto maior que o budget acumulado deixa o saldo
    vermelho e ele **só recupera pelo tempo** (taxaBase) ou por uma entrada — não some
    sozinho. (Se era uma obrigação esperada, lance como **conta** — aí entra pela sobra
    e não vira esse tombo.)
11. **Mesmo dia, entrada e gasto.** O gasto bate cheio; a entrada começa a diluir. São
    tratados separadamente (não se combinam num líquido).

## Exemplo trabalhado (fixture de teste)

Salário R$ 4.000,00; conta fixa (série de saída) R$ 1.000,00 → **sobra livre
R$ 3.000,00 = `300000`**; mês de **30 dias** → custo diário `10000`. Rollover 0.

Avulsos: gasto `25000` no dia 1; entrada `15000` no dia 3; gasto `5000` no dia 4.

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

### Contra-exemplo (gasto não some pelo tempo)

Sobra livre `300000`/30, gasto `310000` no dia 1: saldo(1) = `10000 − 310000 = −300000`,
vermelho, `diasNoVermelho = 30`. Sem uma entrada, fica vermelho **piorando/estável** —
só uma entrada (ex.: `200000` no dia 15, diluída em 16 dias) recalcula a taxa e traz de
volta. Fecha em `300000 − 310000 + 200000 = 190000`.

## Rollover contínuo (`derive.ts`)

`domain.ts` não sabe de "mês anterior" — recebe `saldoInicialCentavos` pronto.
`saldoInicialMes(dados, mk)` soma `sobra livre + entradas avulsas − gastos avulsos` de
todo mês entre o **mês mais antigo com atividade** (menor `data` de lançamento ou
`mesInicio` de série) e o mês anterior a `mk`, inclusive — o que equivale ao saldo do
último dia de cada mês anterior. As contas **não** são somadas aqui (já estão dentro da
sobra livre — contá-las de novo dobraria). Recalculado on the fly a cada leitura.

## Derivações "quanto posso gastar" (features da UI)

- **Posso gastar hoje** = `saldo` do dia de hoje (o cushion disponível agora). "—" se o
  mês exibido não é o de hoje.
- **Por dia** = `custoDiarioMedio = sobra / diasNoMes` (arredondado).
- **Por semana** = custo diário × 7.
- **Gráfico do mês** = a série de `saldo` por dia (de `calcularMesDe`), desenhada como
  SVG: verde acima do zero, vermelho abaixo, com marca do dia de hoje.

## Séries recorrentes (semântica)

- Uma série vale num mês `mk` se `mesInicio ≤ mk ≤ (mesFim ?? ∞)`.
- `rendaMes` = soma das séries de entrada ativas; `contasDoMes` = séries de saída ativas
  + saídas avulsas `conta` do mês; `sobra livre = rendaMes − contasDoMes`.
- **Editar "daqui pra frente" = split**: trunca a série em `mesAnterior(mk)` e cria uma
  nova a partir de `mk` com os valores novos (herda o `mesFim` original). Se `mk` é o
  próprio `mesInicio`, edita em lugar. **Encerrar**: `mk === mesInicio` → exclui; senão
  → `mesFim = mesAnterior(mk)`. O passado nunca é tocado.

## Resumo anual (derivado)

Por mês, de `calcularMes`: total entradas (Σ `entradasCentavos`), total saídas (Σ
`saidasCentavos`), **saldo final** = `saldo` do último dia, dias no vermelho = contagem
de dias `vermelho`.

## Backlog (ideias, não implementado)

Contas variáveis recorrentes (valor por mês numa série de conta, pra não re-lançar
avulso todo mês); subcategorias de gasto + totais por categoria; projeção de fim de mês
("mantendo o ritmo, termina com R$ X"); recorrência com dia fixo (aluguel todo dia 5);
sync com Google Drive e export `.xlsx` (previstos na arquitetura); notificações PWA.
