# Lógica de Domínio — Dias, Saldo, Verde/Vermelho, Entrada/Saída

Especificação da regra de negócio central do app. Implemente exatamente isto.
Todas as funções aqui são **puras e testáveis** (sem I/O, sem estado global).

## Vocabulário

- **Entrada** = dinheiro que ENTRA (recebimento, freela, reembolso). `tipo: "entrada"`.
- **Saída** = dinheiro que SAI (gasto, despesa). `tipo: "saida"`.
- **Custo diário** = quanto você "pode gastar por dia" = (renda − custos fixos) ÷ dias do mês.
- **Budget acumulado** no dia `d` = custo diário somado do dia 1 até `d`.
- **Saldo** = budget acumulado + entradas acumuladas − saídas acumuladas.
- **Verde / Vermelho**: verde se saldo ≥ 0, vermelho se saldo < 0.
- **Dias no vermelho**: quão fundo no vermelho, em dias de custo (deficit ÷ custo diário, arredondado pra cima).

> Nota: no `CLAUDE.md` os tipos aparecem como `gasto`/`recebido`. Padronize tudo em
> **`entrada`/`saida`** (a linguagem usada aqui) e atualize o `CLAUDE.md` pra bater.

## Unidade: centavos inteiros

Todo valor monetário é **inteiro em centavos**. R$ 19,90 = `1990`. Nunca float.
`valorCentavos` de um lançamento é **sempre positivo** — o sinal (entra/sai) vem do `tipo`.

## A ideia em uma frase

Cada dia que passa te dá mais um "custo diário" de budget. Saídas descontam, entradas somam.
Se você gasta o equivalente a N dias de custo além do que tinha, fica **N dias no vermelho**,
e vai voltando pro verde conforme os dias passam (ou na hora, se entrar dinheiro).

## Tipos

```ts
type TipoLancamento = 'entrada' | 'saida';

interface Lancamento {
  id: string;
  data: string;           // 'YYYY-MM-DD' (calendário, sem timezone)
  tipo: TipoLancamento;
  valorCentavos: number;  // SEMPRE > 0
  descricao?: string;
  updatedAt: string;      // ISO
  deleted?: boolean;      // soft delete
}

interface ResumoMes {
  rendaCentavos: number;
  totalFixosCentavos: number;
  sobraCentavos: number;  // renda - fixos (PODE ser negativo)
  diasNoMes: number;      // 28..31
}

interface DiaCalculado {
  dia: number;                 // 1..diasNoMes
  data: string;                // 'YYYY-MM-DD'
  entradasCentavos: number;    // soma das entradas DAQUELE dia
  saidasCentavos: number;      // soma das saídas DAQUELE dia
  budgetAcumCentavos: number;
  saldoCentavos: number;
  status: 'verde' | 'vermelho';
  diasNoVermelho: number;      // 0 quando verde
}
```

## Fórmulas (na ordem certa)

### 1. Dias no mês
```ts
// mes é 1-12. Truque: dia 0 do mês seguinte = último dia do mês atual.
function diasNoMes(ano: number, mes: number): number {
  return new Date(ano, mes, 0).getDate();
}
```

### 2. Sobra e custo diário
```ts
const sobraCentavos = rendaCentavos - totalFixosCentavos; // pode ser negativo
// custo diário MÉDIO, em float, usado só pra razão "dias no vermelho":
const custoDiarioMedio = sobraCentavos / diasNoMes;
```

### 3. Budget acumulado — use a fórmula PROPORCIONAL (evita drift de arredondamento)
```ts
// NÃO faça round(custoDiario) e multiplique por d — o erro acumula.
// Calcule o acumulado direto da sobra e arredonde só o resultado:
function budgetAcumCentavos(sobraCentavos: number, diasNoMes: number, d: number): number {
  return Math.round((sobraCentavos * d) / diasNoMes);
}
// Garantia: no último dia, budgetAcum(diasNoMes) === sobraCentavos (fecha exato).
```

### 4. Saldo do dia
```ts
saldoCentavos = budgetAcumCentavos(d) + entradasAcumCentavos(d) - saidasAcumCentavos(d);
// tudo inteiro -> saldo é inteiro.
status = saldoCentavos >= 0 ? 'verde' : 'vermelho';
```

### 5. Dias no vermelho
```ts
// Só faz sentido quando custoDiarioMedio > 0.
diasNoVermelho =
  saldoCentavos >= 0 || custoDiarioMedio <= 0
    ? 0
    : Math.ceil(-saldoCentavos / custoDiarioMedio);
```

## Algoritmo: calcular o mês inteiro

```ts
function calcularMes(
  ano: number,
  mes: number,                 // 1-12
  resumo: ResumoMes,
  lancamentos: Lancamento[],   // TODOS os lançamentos; filtramos aqui
): DiaCalculado[] {
  const { sobraCentavos, diasNoMes } = resumo;
  const custoDiarioMedio = sobraCentavos / diasNoMes;

  // 1. filtra: não deletados + dentro do mês; agrupa por dia
  const prefixo = `${ano}-${String(mes).padStart(2, '0')}-`; // 'YYYY-MM-'
  const porDia = new Map<number, { entrada: number; saida: number }>();
  for (const l of lancamentos) {
    if (l.deleted) continue;
    if (!l.data.startsWith(prefixo)) continue;
    const d = Number(l.data.slice(8, 10)); // dia
    const acc = porDia.get(d) ?? { entrada: 0, saida: 0 };
    if (l.tipo === 'entrada') acc.entrada += l.valorCentavos;
    else acc.saida += l.valorCentavos;
    porDia.set(d, acc);
  }

  // 2. varre dia a dia acumulando
  const dias: DiaCalculado[] = [];
  let entradasAcum = 0;
  let saidasAcum = 0;
  for (let d = 1; d <= diasNoMes; d++) {
    const doDia = porDia.get(d) ?? { entrada: 0, saida: 0 };
    entradasAcum += doDia.entrada;
    saidasAcum += doDia.saida;

    const budgetAcum = Math.round((sobraCentavos * d) / diasNoMes);
    const saldo = budgetAcum + entradasAcum - saidasAcum;
    const status = saldo >= 0 ? 'verde' : 'vermelho';
    const diasNoVermelho =
      saldo >= 0 || custoDiarioMedio <= 0
        ? 0
        : Math.ceil(-saldo / custoDiarioMedio);

    dias.push({
      dia: d,
      data: `${prefixo}${String(d).padStart(2, '0')}`,
      entradasCentavos: doDia.entrada,
      saidasCentavos: doDia.saida,
      budgetAcumCentavos: budgetAcum,
      saldoCentavos: saldo,
      status,
      diasNoVermelho,
    });
  }
  return dias;
}
```

## Casos de borda (trate todos)

1. **Mês curto (fev) / longo.** `diasNoMes` resolve; nunca hardcode 30/31. Dias que não
   existem no mês simplesmente não entram no array (o loop vai só até `diasNoMes`).
2. **Dia sem lançamento.** entradas/saídas = 0, mas o budget continua acumulando → saldo
   se recupera sozinho com o tempo.
3. **Sobra negativa (fixos ≥ renda).** `custoDiarioMedio <= 0`: tudo fica vermelho desde o
   dia 1 e `diasNoVermelho` retorna 0 (razão não faz sentido). A UI deve mostrar um aviso
   tipo "custos fixos ≥ renda" em vez de um número de dias.
4. **valorCentavos negativo ou zero.** Rejeite na entrada de dados; o sinal é o `tipo`.
5. **Saldo exatamente 0.** É **verde** (regra é `>= 0`).
6. **Data fora do mês.** Ignorada pelo filtro `startsWith(prefixo)`.
7. **Lançamento com `deleted: true`.** Ignorado (mas fica no JSON pro merge futuro).
8. **"Hoje".** Compare `dia.data === hojeISO()` pra destacar a linha; se hoje não está no
   mês exibido, nenhum destaque.

## Exemplo trabalhado (use como fixture de teste)

Config: renda R$ 4.000,00; custos fixos R$ 1.000,00 → **sobra R$ 3.000,00 = `300000`**;
mês de **30 dias** → custo diário médio = R$ 100,00 = `10000`.

Lançamentos:
- Dia 1: **saída** R$ 250,00 (`25000`) — gastou ~2,5 dias de custo de uma vez
- Dia 3: **entrada** R$ 150,00 (`15000`)
- Dia 4: **saída** R$ 50,00 (`5000`)

Resultado esperado (centavos):

| dia | budgetAcum | entradaDia | saidaDia | saldo   | status   | diasNoVermelho |
|-----|-----------:|-----------:|---------:|--------:|----------|---------------:|
| 1   | 10000      | 0          | 25000    | -15000  | vermelho | 2              |
| 2   | 20000      | 0          | 0        | -5000   | vermelho | 1              |
| 3   | 30000      | 15000      | 0        | 20000   | verde    | 0              |
| 4   | 40000      | 0          | 5000     | 25000   | verde    | 0              |
| 5   | 50000      | 0          | 0        | 35000   | verde    | 0              |
| ... |            |            |          |         |          |                |
| 30  | 300000     | 0          | 0        | 285000  | verde    | 0              |

Leitura: no dia 1 estourou o equivalente a mais de 2 dias → **vermelho por 2 dias**;
no dia 2 o novo budget diário reduz o buraco pra 1 dia; no dia 3 a entrada de R$150 já
devolve pro verde na hora.

## Casos de teste sugeridos (transforme em unit tests)

1. **Fecha o mês exato:** com o exemplo acima, `budgetAcum(30) === 300000` (=sobra).
2. **Arredondamento sem drift:** sobra `265000`, 31 dias → `budgetAcum(31) === 265000`
   (mesmo o custo médio sendo `8548,38...`).
3. **Recuperação por tempo:** um único gasto de `25000` no dia 1 (sobra `300000`/30 dias)
   → vermelho nos dias 1 e 2, verde do dia 3 em diante, sem novos lançamentos.
4. **Recuperação por entrada:** mesmo gasto, mas com entrada `20000` no dia 1 → dia 1 já
   fica verde (`10000 + 20000 - 25000 = 5000`).
5. **Sobra negativa:** renda `100000`, fixos `120000` → todos os dias vermelho,
   `diasNoVermelho === 0` em todos, e a UI mostra aviso.
6. **Fevereiro:** ano 2026, mês 2 → `diasNoMes === 28`, array tem 28 itens.
   Ano 2028 (bissexto) → 29 itens.
7. **Soft delete:** um lançamento com `deleted: true` não afeta nenhum saldo.

## Resumo anual (derivado dos meses)

Para cada mês, a partir de `calcularMes` e do `ResumoMes`:
- **Total entradas** = soma de `entradasCentavos` dos dias.
- **Total saídas** = soma de `saidasCentavos` dos dias.
- **Saldo final** = `sobraCentavos + totalEntradas − totalSaidas`
  (equivale ao `saldoCentavos` do último dia).
- **Dias no vermelho no mês** = contagem de dias com `status === 'vermelho'`.