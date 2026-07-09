# Lógica de Domínio — Dias, Saldo, Verde/Vermelho, Entrada/Saída

Especificação da regra de negócio central do app. Implemente exatamente isto.
Todas as funções aqui são **puras e testáveis** (sem I/O, sem estado global).

## Vocabulário

- **Entrada** = dinheiro que ENTRA (recebimento, freela, reembolso). `tipo: "entrada"`.
- **Saída** = dinheiro que SAI (gasto, despesa). `tipo: "saida"`.
- **Custo diário base** = quanto a sobra do mês "dá por dia" = (renda − custos fixos) ÷
  dias do mês. É o ponto de partida do dia 1, antes de qualquer lançamento avulso.
- **Saldo inicial** do mês = saldo final do mês anterior — o acumulado **rola** de um mês
  pro outro (rollover contínuo desde o primeiro lançamento/série que existir).
- **Replanejamento por evento**: nada bate no saldo de uma vez só. Cada lançamento
  avulso (e o saldo inicial herdado) é um **evento** cujo valor é dividido pelos dias
  que restam do mês **a partir do dia em que aconteceu** (inclusive), e passa a somar
  à taxa diária dali pra frente. O app está **sempre recalculando** com base no que
  entrou e saiu até agora.
- **Verde / Vermelho**: verde se saldo ≥ 0, vermelho se saldo < 0.
- **Dias no vermelho**: quão fundo no vermelho, em dias de custo no **ritmo diário
  atual** (deficit ÷ taxa diária efetiva do dia, arredondado pra cima).

> Nota: no `CLAUDE.md` os tipos aparecem como `gasto`/`recebido`. Padronize tudo em
> **`entrada`/`saida`** (a linguagem usada aqui) e atualize o `CLAUDE.md` pra bater.

## Unidade: centavos inteiros

Todo valor monetário é **inteiro em centavos**. R$ 19,90 = `1990`. Nunca float.
`valorCentavos` de um lançamento é **sempre positivo** — o sinal (entra/sai) vem do `tipo`.

## A ideia em uma frase

Cada dia que passa te dá mais um pouco de budget — vindo da sobra do mês E de todo
lançamento que já aconteceu, cada um diluído pelos dias que sobraram quando ele
aconteceu. Um gasto de hoje não é descontado de uma vez: ele reduz sua taxa diária
pelo resto do mês. Uma entrada de hoje não aparece inteira de uma vez: ela aumenta sua
taxa diária pelo resto do mês. O saldo é sempre "onde você estaria se nada mais
acontecesse", recalculado a cada novo lançamento.

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
  entradasCentavos: number;    // soma das entradas DAQUELE dia (bruto, só exibição)
  saidasCentavos: number;      // soma das saídas DAQUELE dia (bruto, só exibição)
  budgetAcumCentavos: number;  // só a base (sobra + saldoInicial) suavizada, sem os lançamentos
  saldoCentavos: number;       // base + cada lançamento, cada um diluído a partir do seu dia
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

### 2. Sobra e base acumulável
```ts
const sobraCentavos = rendaCentavos - totalFixosCentavos; // pode ser negativo
// saldoInicialCentavos = saldo final do mês anterior (rollover; 0 se não houver mês
// anterior com atividade). Junto com a sobra, forma a "base" — o evento do dia 1,
// que vale pelo mês inteiro (diasRestantes = diasNoMes).
const baseAcumulavel = sobraCentavos + saldoInicialCentavos;
```

### 3. Cada lançamento avulso é um evento, diluído pelos dias restantes
```ts
// Pra cada dia com lançamento(s): soma entradas - saídas daquele dia = valor líquido.
// diasRestantes conta o PRÓPRIO dia do evento (ele já começa a valer hoje).
function taxaDoEvento(valorLiquidoCentavos: number, diaDoEvento: number, diasNoMes: number): number {
  const diasRestantes = diasNoMes - diaDoEvento + 1;
  return valorLiquidoCentavos / diasRestantes; // float — só arredonda o total do dia (seção 4)
}
```

### 4. Taxa diária efetiva e saldo acumulado no dia `d`
```ts
// taxaBase = base acumulável dividida pelos dias do mês (vale desde o dia 1).
const taxaBase = baseAcumulavel / diasNoMes;

// No dia d, a taxa diária EFETIVA soma a taxaBase com a taxa de todo evento cujo
// dia já passou (diaDoEvento <= d). Eventos futuros ainda não contam.
// saldoBruto(d) = taxaBase*d + soma, pra cada evento com diaDoEvento <= d, de
//   taxaDoEvento * (d - diaDoEvento + 1)
// Arredonda só o total do dia (evita drift de arredondamento acumulado):
saldoCentavos = Math.round(saldoBruto(d));
status = saldoCentavos >= 0 ? 'verde' : 'vermelho';
```

**Garantia de fechamento exato:** no último dia (`d === diasNoMes`), cada evento
contribui com `taxaDoEvento * diasRestantes === valorLiquidoCentavos` exato (a divisão
"desfaz" na multiplicação). Então `saldoCentavos` no último dia é sempre
`sobraCentavos + saldoInicialCentavos + Σ entradas − Σ saídas` — bate com a soma crua,
não importa a ordem ou o dia dos lançamentos.

### 5. Dias no vermelho (usa a taxa diária EFETIVA, não a base)
```ts
// taxaDiaria(d) = taxaBase + soma das taxas de todo evento já ocorrido até d.
// Só faz sentido quando taxaDiaria(d) > 0 — senão o "ritmo atual" não te tira do buraco.
diasNoVermelho =
  saldoCentavos >= 0 || taxaDiaria(d) <= 0
    ? 0
    : Math.ceil(-saldoCentavos / taxaDiaria(d));
```

## Algoritmo: calcular o mês inteiro

```ts
function calcularMes(
  ano: number,
  mes: number,                 // 1-12
  resumo: ResumoMes,
  lancamentos: Lancamento[],   // TODOS os lançamentos; filtramos aqui
  saldoInicialCentavos = 0,    // saldo final do mês anterior (rollover); quem soma os
                                // meses anteriores é a camada de cima (derive.ts), não aqui
): DiaCalculado[] {
  const { sobraCentavos, diasNoMes } = resumo;
  const baseAcumulavel = sobraCentavos + saldoInicialCentavos;
  const taxaBase = baseAcumulavel / diasNoMes;

  // 1. filtra: não deletados + dentro do mês; agrupa por dia (bruto)
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

  // 2. um evento por dia com lançamento: valor líquido, taxa = valor / diasRestantes
  const eventos: Array<{ dia: number; taxa: number }> = [];
  for (const [dia, { entrada, saida }] of porDia) {
    const valorLiquido = entrada - saida;
    if (valorLiquido === 0) continue;
    const diasRestantes = diasNoMes - dia + 1;
    eventos.push({ dia, taxa: valorLiquido / diasRestantes });
  }

  // 3. varre dia a dia: taxa diária efetiva = base + taxa de todo evento já ocorrido
  const dias: DiaCalculado[] = [];
  for (let d = 1; d <= diasNoMes; d++) {
    const doDia = porDia.get(d) ?? { entrada: 0, saida: 0 };

    let taxaDiaria = taxaBase;
    let saldoBruto = taxaBase * d;
    for (const ev of eventos) {
      if (ev.dia > d) continue;
      taxaDiaria += ev.taxa;
      saldoBruto += ev.taxa * (d - ev.dia + 1);
    }

    const saldo = Math.round(saldoBruto);
    const status = saldo >= 0 ? 'verde' : 'vermelho';
    const diasNoVermelho =
      saldo >= 0 || taxaDiaria <= 0 ? 0 : Math.ceil(-saldo / taxaDiaria);

    dias.push({
      dia: d,
      data: `${prefixo}${String(d).padStart(2, '0')}`,
      entradasCentavos: doDia.entrada,
      saidasCentavos: doDia.saida,
      budgetAcumCentavos: Math.round((baseAcumulavel * d) / diasNoMes),
      saldoCentavos: saldo,
      status,
      diasNoVermelho,
    });
  }
  return dias;
}
```

Complexidade: `O(diasNoMes × eventos)`. Pra uso pessoal (no máximo ~31 eventos/mês)
é trivial — nada de otimizar prematuramente.

## Casos de borda (trate todos)

1. **Mês curto (fev) / longo.** `diasNoMes` resolve; nunca hardcode 30/31. Dias que não
   existem no mês simplesmente não entram no array (o loop vai só até `diasNoMes`).
2. **Dia sem lançamento.** Sem evento novo naquele dia; a taxa diária efetiva continua
   a mesma do dia anterior.
3. **Sobra negativa (fixos ≥ renda), sem lançamentos.** `taxaBase <= 0`: tudo fica
   vermelho desde o dia 1 e `diasNoVermelho` retorna 0 (razão não faz sentido). A UI
   deve mostrar um aviso tipo "custos fixos ≥ renda" em vez de um número de dias.
4. **valorCentavos negativo ou zero.** Rejeite na entrada de dados; o sinal é o `tipo`.
5. **Saldo exatamente 0.** É **verde** (regra é `>= 0`).
6. **Data fora do mês.** Ignorada pelo filtro `startsWith(prefixo)`.
7. **Lançamento com `deleted: true`.** Ignorado (mas fica no JSON pro merge futuro).
8. **"Hoje".** Compare `dia.data === hojeISO()` pra destacar a linha; se hoje não está no
   mês exibido, nenhum destaque.
9. **Rollover entre meses.** `saldoInicialCentavos` do mês N é o `saldoCentavos` do
   último dia do mês N-1 (que já inclui o saldo inicial DELE, recursivamente). Sem mês
   anterior com atividade, é 0. Pode ser negativo (mês anterior fechou no vermelho) —
   vira parte da base do dia 1, diluída pelo mês inteiro como qualquer sobra.
10. **Um evento "vence" o resto do mês.** Se a taxa de um lançamento (negativa) supera
    a taxa diária vigente, a taxa diária efetiva fica negativa dali em diante — o saldo
    passa a **cair todo dia**, não só naquele dia, até que outro lançamento (uma
    entrada) recalcule a taxa de novo. Isso é esperado: o app está sempre replanejando
    com o que sabe até agora, não "perdoa" um gasto grande com o tempo sozinho — só uma
    entrada nova (ou o próximo mês) muda o rumo.
11. **Mesmo dia, entrada e saída.** Somam num único evento líquido antes de dividir
    pelos dias restantes — matematicamente idêntico a tratá-los como dois eventos
    separados (a mesma divisão, os mesmos dias restantes).

## Exemplo trabalhado (use como fixture de teste)

Config: renda R$ 4.000,00; custos fixos R$ 1.000,00 → **sobra R$ 3.000,00 = `300000`**;
mês de **30 dias** → taxa base = R$ 100,00/dia = `10000`.

Lançamentos:
- Dia 1: **saída** R$ 250,00 (`25000`) → evento de `-25000/30 = -833,33…`/dia
- Dia 3: **entrada** R$ 150,00 (`15000`) → evento de `15000/28 = 535,71…`/dia
- Dia 4: **saída** R$ 50,00 (`5000`) → evento de `-5000/27 = -185,19…`/dia

Resultado esperado (centavos) — **nenhum lançamento bate de uma vez só**, cada um
dilui sua parcela a partir do próprio dia:

| dia | entradaDia | saidaDia | saldo   | status | diasNoVermelho |
|-----|-----------:|---------:|--------:|--------|---------------:|
| 1   | 0          | 25000    | 9167    | verde  | 0              |
| 2   | 0          | 0        | 18333   | verde  | 0              |
| 3   | 15000      | 0        | 28036   | verde  | 0              |
| 4   | 0          | 5000     | 37553   | verde  | 0              |
| 5   | 0          | 0        | 47070   | verde  | 0              |
| ... |            |          |         |        |                |
| 30  | 0          | 0        | 285000  | verde  | 0              |

Leitura: a saída de R$ 250 no dia 1 não derruba o saldo — ela só reduz a taxa diária em
~R$ 8,33 pelo resto do mês (`833,33` já contando o próprio dia 1), e a taxa base
(R$ 100/dia) mais que compensa, então o mês inteiro fica verde. O dia 30 fecha exato em
`300000 + 15000 − 30000 = 285000`, igual seria com qualquer outra ordem/data dos
mesmos lançamentos.

### Exemplo 2: quando um evento supera a taxa vigente (vermelho até uma correção)

Mesma sobra (R$ 3.000,00, taxa base R$ 100,00/dia, 30 dias), mas agora:
- Dia 1: **saída** R$ 3.100,00 (`310000`) — maior que a sobra do mês inteiro.
  Evento: `-310000/30 = -10333,33…`/dia.
- Dia 15: **entrada** R$ 2.000,00 (`200000`) — corrige o rumo.
  Evento: `200000/16 = 12500`/dia (`16` = dias restantes a partir do dia 15).

| dia | saldo   | status   | motivo |
|-----|--------:|----------|--------|
| 1   | -333    | vermelho | taxa diária vira `10000 - 10333,33 = -333,33` (negativa) |
| 14  | -4667   | vermelho | taxa ainda negativa — o saldo só piora, dia após dia |
| 15  | 7500    | verde    | taxa diária vira `-333,33 + 12500 = 12166,67` (positiva de novo) |
| 30  | 190000  | verde    | fecha exato: `300000 - 310000 + 200000` |

Sem a entrada do dia 15, o mês inteiro ficaria vermelho e **piorando todo dia** — não
existe "recuperação automática pelo tempo" nesse modelo: um gasto grande demais só se
resolve com uma entrada (ou no próximo mês).

## Casos de teste sugeridos (transforme em unit tests)

1. **Fecha o mês exato:** com os exemplos acima, o saldo do último dia sempre bate com
   `sobra + saldoInicial + Σentradas − Σsaídas`, não importa quando os lançamentos
   aconteceram.
2. **Arredondamento sem drift:** sobra `265000`, 31 dias, sem lançamentos → o saldo do
   dia 31 é exatamente `265000` (mesmo a taxa diária sendo `8548,38...`).
3. **Evento que vence a taxa vigente:** Exemplo 2 acima — vermelho persistente até uma
   entrada recalcular a taxa diária.
4. **Mesmo dia, entrada e saída:** se combinam num evento líquido só — o saldo bate
   igual ao de um único lançamento com o valor líquido, na mesma data.
5. **Sobra negativa, sem lançamentos:** todos os dias vermelho, `diasNoVermelho === 0`
   em todos (taxa não-positiva), e a UI mostra aviso.
6. **Fevereiro:** ano 2026, mês 2 → `diasNoMes === 28`, array tem 28 itens.
   Ano 2028 (bissexto) → 29 itens.
7. **Soft delete:** um lançamento com `deleted: true` não vira evento — como se não
   existisse.

## Resumo anual (derivado dos meses)

Para cada mês, a partir de `calcularMes`:
- **Total entradas** = soma de `entradasCentavos` dos dias.
- **Total saídas** = soma de `saidasCentavos` dos dias.
- **Saldo final** = `saldoCentavos` do último dia (já inclui o saldo inicial herdado,
  se `calcularMes` foi chamado com um).
- **Dias no vermelho no mês** = contagem de dias com `status === 'vermelho'`.

## Rollover contínuo entre meses (`derive.ts`)

`domain.ts` não sabe nada sobre "mês anterior" — ele só recebe `saldoInicialCentavos`
como número pronto e o trata como parte da base do dia 1 (seção 2), diluída pelo mês
inteiro. Quem calcula esse número é `derive.ts`:

- `saldoInicialMes(dados, mk)` = soma de `sobraCentavos + entradas avulsas − saídas
  avulsas` de todo mês entre o **mês mais antigo com alguma atividade** (menor `data`
  de lançamento ou `mesInicio` de série) e o mês anterior a `mk`, inclusive. Isso dá o
  mesmo resultado que somar o `saldoCentavos` do último dia de cada mês anterior — o
  fechamento exato (seção 4) garante que a soma bate independente da forma como o
  saldo foi diluído dentro de cada mês.
- Sem nenhuma atividade antes de `mk` (ou `mk` é o próprio mês onde tudo começou), o
  saldo inicial é `0`.
- É recalculado on the fly a cada leitura (regra 4) — nada de saldo acumulado gravado
  no JSON. Pra uso pessoal (~365 lançamentos/ano, poucos anos de histórico) isso é
  barato o bastante pra não precisar de cache.
