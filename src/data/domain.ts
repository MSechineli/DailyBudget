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
  entradasCentavos: number; // soma das entradas DAQUELE dia
  saidasCentavos: number; // soma das saídas DAQUELE dia
  budgetAcumCentavos: number;
  saldoCentavos: number;
  status: 'verde' | 'vermelho';
  diasNoVermelho: number; // 0 quando verde
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
 * budgetAcum(diasNoMes) === sobraCentavos (fecha exato).
 */
export function budgetAcumCentavos(sobraCentavos: number, diasNoMes: number, d: number): number {
  return Math.round((sobraCentavos * d) / diasNoMes);
}

// Só os campos que o cálculo precisa — aceita o Lancamento completo do schema.
type LancamentoCalc = Pick<Lancamento, 'data' | 'tipo' | 'valorCentavos'> & { deleted?: boolean };

/**
 * Calcula o mês inteiro dia a dia. Filtra os lançamentos do mês (ignora
 * deletados e datas fora do mês), agrupa por dia e varre acumulando.
 */
export function calcularMes(
  ano: number,
  mes: number, // 1-12
  resumo: ResumoMes,
  lancamentos: LancamentoCalc[],
): DiaCalculado[] {
  const { sobraCentavos, diasNoMes } = resumo;
  const custoDiarioMedio = sobraCentavos / diasNoMes;

  // 1. filtra + agrupa por dia
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

  // 2. varre dia a dia acumulando
  const dias: DiaCalculado[] = [];
  let entradasAcum = 0;
  let saidasAcum = 0;
  for (let d = 1; d <= diasNoMes; d++) {
    const doDia = porDia.get(d) ?? { entrada: 0, saida: 0 };
    entradasAcum += doDia.entrada;
    saidasAcum += doDia.saida;

    const budgetAcum = budgetAcumCentavos(sobraCentavos, diasNoMes, d);
    const saldo = budgetAcum + entradasAcum - saidasAcum;
    const status: DiaCalculado['status'] = saldo >= 0 ? 'verde' : 'vermelho';
    // Dias no vermelho só faz sentido com custo diário médio positivo.
    const diasNoVermelho =
      saldo >= 0 || custoDiarioMedio <= 0 ? 0 : Math.ceil(-saldo / custoDiarioMedio);

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

/** Agrega um mês já calculado (para o resumo anual). */
export function agregarMes(dias: DiaCalculado[], resumo: ResumoMes): ResumoMensalAgregado {
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
    saldoFinalCentavos: resumo.sobraCentavos + totalEntradas - totalSaidas,
    diasNoVermelho: diasVermelho,
  };
}

export type { TipoLancamento };
