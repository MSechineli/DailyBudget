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
  budgetAcumCentavos: number; // só a base (sobra + saldoInicial) suavizada, sem os lançamentos
  saldoCentavos: number; // base + cada lançamento, cada um suavizado pelos dias restantes A PARTIR do dia em que aconteceu
  status: 'verde' | 'vermelho';
  diasNoVermelho: number; // 0 quando verde; usa a taxa diária EFETIVA do dia (base + lançamentos já ocorridos)
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
 * Budget acumulado até o dia `d`, fórmula PROPORCIONAL (evita drift de
 * arredondamento). Arredonda só o resultado final. Garantia: no último dia,
 * budgetAcum(diasNoMes) === baseCentavos (fecha exato). `baseCentavos` é o
 * total a dividir pelos dias do mês — normalmente `sobra + saldoInicial`.
 */
export function budgetAcumCentavos(baseCentavos: number, diasNoMes: number, d: number): number {
  return Math.round((baseCentavos * d) / diasNoMes);
}

// Só os campos que o cálculo precisa — aceita o Lancamento completo do schema.
type LancamentoCalc = Pick<Lancamento, 'data' | 'tipo' | 'valorCentavos'> & { deleted?: boolean };

/**
 * Calcula o mês inteiro dia a dia. Filtra os lançamentos do mês (ignora
 * deletados e datas fora do mês), agrupa por dia e varre replanejando.
 *
 * Modelo: nada bate no saldo de uma vez só. `saldoInicialCentavos` (rollover
 * do mês anterior — regra 4: derivado, não guardado; quem soma os meses
 * anteriores é `derive.ts`) e a sobra do mês formam a base, dividida pelos
 * `diasNoMes` a partir do dia 1. Cada lançamento AVULSO é um evento novo: seu
 * valor é dividido pelos dias que restam do mês A PARTIR do dia em que
 * aconteceu (inclusive) e passa a somar a essa taxa diária dali pra frente —
 * "sempre recalculando com base no que entra e sai". Todo evento fecha exato
 * no último dia do mês (soma tudo: base + cada lançamento no valor cheio).
 */
export function calcularMes(
  ano: number,
  mes: number, // 1-12
  resumo: ResumoMes,
  lancamentos: LancamentoCalc[],
  saldoInicialCentavos = 0,
): DiaCalculado[] {
  const { sobraCentavos, diasNoMes } = resumo;
  const baseAcumulavel = sobraCentavos + saldoInicialCentavos;
  const taxaBase = baseAcumulavel / diasNoMes;

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

  // 2. um evento por dia com lançamento: valor líquido (entrada - saída),
  // dividido pelos dias restantes do mês a partir daquele dia (inclusive).
  const eventos: Array<{ dia: number; taxa: number }> = [];
  for (const [dia, { entrada, saida }] of porDia) {
    const valorLiquido = entrada - saida;
    if (valorLiquido === 0) continue;
    const diasRestantes = diasNoMes - dia + 1;
    eventos.push({ dia, taxa: valorLiquido / diasRestantes });
  }

  // 3. varre dia a dia: taxa diária efetiva = base + taxa de todo evento já
  // ocorrido (dia do evento <= d). Arredonda só o total do dia (evita drift).
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
    const status: DiaCalculado['status'] = saldo >= 0 ? 'verde' : 'vermelho';
    // Dias no vermelho usa a taxa diária EFETIVA do dia (com tudo que já entrou/saiu).
    const diasNoVermelho =
      saldo >= 0 || taxaDiaria <= 0 ? 0 : Math.ceil(-saldo / taxaDiaria);

    dias.push({
      dia: d,
      data: `${prefixo}${String(d).padStart(2, '0')}`,
      entradasCentavos: doDia.entrada,
      saidasCentavos: doDia.saida,
      budgetAcumCentavos: budgetAcumCentavos(baseAcumulavel, diasNoMes, d),
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
