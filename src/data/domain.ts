import { diasNoMes } from './dates.ts';
import type { Lancamento, TipoLancamento } from './schema.ts';

// Lógica de domínio PURA (sem I/O, sem estado global). Espelha DOMINIO.md.
// Entrada = dinheiro que entra; Saída = dinheiro que sai. valorCentavos é
// sempre positivo — o sinal vem do `tipo`. Tudo em centavos inteiros.

export interface ResumoMes {
  rendaCentavos: number;
  totalFixosCentavos: number;
  sobraCentavos: number; // renda − fixos (PODE ser negativo)
  diasNoMes: number; // 28..31
}

export interface DiaCalculado {
  dia: number; // 1..diasNoMes
  data: string; // 'YYYY-MM-DD'
  entradasCentavos: number; // soma das entradas DAQUELE dia (bruto, só exibição)
  saidasCentavos: number; // soma das saídas DAQUELE dia (bruto, só exibição)
  budgetAcumCentavos: number; // tudo que você "tem/ganhou" até d (rollover + base + entradas diluídas), SEM descontar saídas
  saldoCentavos: number; // budgetAcumCentavos − saídas acumuladas (saídas batem cheias no dia)
  status: 'verde' | 'vermelho';
  diasNoVermelho: number; // 0 quando verde; usa a taxa diária de recuperação (base + entradas diluídas ativas)
}

/** Monta um ResumoMes a partir dos números crus do mês. */
export function montarResumoMes(
  ano: number,
  mes: number,
  rendaCentavos: number,
  totalFixosCentavos: number,
): ResumoMes {
  return {
    rendaCentavos,
    totalFixosCentavos,
    sobraCentavos: rendaCentavos - totalFixosCentavos,
    diasNoMes: diasNoMes(ano, mes),
  };
}

/**
 * Acúmulo proporcional de `baseCentavos` até o dia `d` (fórmula PROPORCIONAL,
 * evita drift de arredondamento). Arredonda só o resultado final. Garantia: no
 * último dia, retorna `baseCentavos` exato. Usado pra diluir a sobra do mês
 * (custo diário) igual pelos dias.
 */
export function budgetAcumCentavos(baseCentavos: number, diasNoMes: number, d: number): number {
  return Math.round((baseCentavos * d) / diasNoMes);
}

// Só os campos que o cálculo precisa — aceita o Lancamento completo do schema.
type LancamentoCalc = Pick<Lancamento, 'data' | 'tipo' | 'valorCentavos'> & { deleted?: boolean };

/**
 * Calcula o mês inteiro dia a dia. Filtra os lançamentos do mês (ignora
 * deletados e datas fora do mês), agrupa por dia e varre acumulando.
 *
 * Modelo (ver DOMINIO.md):
 * - **Sobra do mês** (receitas − custos fixos recorrentes) vira a `taxaBase`,
 *   diluída igual por todos os dias (o "custo diário").
 * - **Rollover** (`saldoInicialCentavos`, o saldo herdado do mês anterior —
 *   regra 4: derivado, não guardado; quem soma os meses anteriores é
 *   `derive.ts`) entra IMEDIATO: offset constante somado a todos os dias.
 * - **Entrada avulsa** → DILUÍDA: seu valor é dividido pelos dias que restam do
 *   mês a partir do dia em que aconteceu (inclusive) e soma à taxa diária dali
 *   pra frente (vira "budget diário extra").
 * - **Saída avulsa** → IMEDIATA: bate o valor cheio no dia em que ocorreu e
 *   continua descontada dali pra frente. O saldo se recupera sozinho conforme o
 *   budget diário acumula.
 *
 * Fecha exato no último dia: `saldoInicial + sobra + Σentradas − Σsaídas`.
 */
export function calcularMes(
  ano: number,
  mes: number, // 1-12
  resumo: ResumoMes,
  lancamentos: LancamentoCalc[],
  saldoInicialCentavos = 0,
): DiaCalculado[] {
  const { sobraCentavos, diasNoMes } = resumo;
  const taxaBase = sobraCentavos / diasNoMes;

  // 1. filtra + agrupa por dia (bruto, pra exibição E pra montar os eventos)
  const prefixo = `${ano}-${String(mes).padStart(2, '0')}-`; // 'YYYY-MM-'
  const porDia = new Map<number, { entrada: number; saida: number }>();
  for (const l of lancamentos) {
    if (l.deleted) continue;
    if (!l.data.startsWith(prefixo)) continue;
    const d = Number(l.data.slice(8, 10));
    const acc = porDia.get(d) ?? { entrada: 0, saida: 0 };
    if (l.tipo === 'entrada') acc.entrada += l.valorCentavos;
    else acc.saida += l.valorCentavos;
    porDia.set(d, acc);
  }

  // 2. cada ENTRADA vira um evento diluído pelos dias restantes a partir do
  // seu dia (inclusive). Saídas NÃO viram evento — batem cheias (passo 3).
  const eventosEntrada: Array<{ dia: number; taxa: number }> = [];
  for (const [dia, { entrada }] of porDia) {
    if (entrada === 0) continue;
    const diasRestantes = diasNoMes - dia + 1;
    eventosEntrada.push({ dia, taxa: entrada / diasRestantes });
  }

  // 3. varre dia a dia. budgetBruto = rollover (imediato) + base diluída +
  // entradas diluídas já ativas. Saídas acumulam cheias e descontam do saldo.
  const dias: DiaCalculado[] = [];
  let saidasAcum = 0;
  for (let d = 1; d <= diasNoMes; d++) {
    const doDia = porDia.get(d) ?? { entrada: 0, saida: 0 };
    saidasAcum += doDia.saida;

    let taxaDiaria = taxaBase;
    let budgetBruto = saldoInicialCentavos + taxaBase * d;
    for (const ev of eventosEntrada) {
      if (ev.dia > d) continue;
      taxaDiaria += ev.taxa;
      budgetBruto += ev.taxa * (d - ev.dia + 1);
    }

    // Arredonda só o budget (float) — saídas já são inteiras. Fecha exato no fim.
    const budgetAcum = Math.round(budgetBruto);
    const saldo = budgetAcum - saidasAcum;
    const status: DiaCalculado['status'] = saldo >= 0 ? 'verde' : 'vermelho';
    // Dias no vermelho: taxa de RECUPERAÇÃO (base + entradas diluídas ativas);
    // saídas são one-time, não entram na taxa.
    const diasNoVermelho =
      saldo >= 0 || taxaDiaria <= 0 ? 0 : Math.ceil(-saldo / taxaDiaria);

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

export interface ResumoMensalAgregado {
  totalEntradasCentavos: number;
  totalSaidasCentavos: number;
  saldoFinalCentavos: number; // = saldo do último dia = sobra + entradas − saídas
  diasNoVermelho: number; // contagem de dias com status 'vermelho'
}

/**
 * Agrega um mês já calculado (para o resumo anual). `saldoFinalCentavos` é o
 * saldo do último dia — já inclui o saldo inicial herdado, se `calcularMes`
 * foi chamado com um.
 */
export function agregarMes(dias: DiaCalculado[]): ResumoMensalAgregado {
  let totalEntradas = 0;
  let totalSaidas = 0;
  let diasVermelho = 0;
  for (const d of dias) {
    totalEntradas += d.entradasCentavos;
    totalSaidas += d.saidasCentavos;
    if (d.status === 'vermelho') diasVermelho++;
  }
  return {
    totalEntradasCentavos: totalEntradas,
    totalSaidasCentavos: totalSaidas,
    saldoFinalCentavos: dias.length ? dias[dias.length - 1]!.saldoCentavos : 0,
    diasNoVermelho: diasVermelho,
  };
}

export type { TipoLancamento };
