import { mesKeyDeData, mesSeguinte, parseMesKey, type ISODate, type MesKey } from './dates.ts';
import {
  agregarMes,
  calcularMes,
  montarResumoMes,
  type DiaCalculado,
  type ResumoMensalAgregado,
  type ResumoMes,
} from './domain.ts';
import type {
  AppData,
  CategoriaLancamento,
  Lancamento,
  SerieRecorrente,
  TipoLancamento,
} from './schema.ts';

// Ponte entre o AppData persistido e o domínio puro (domain.ts). Resolve
// quais séries recorrentes valem em cada mês e monta os inputs que as
// funções puras esperam.
// Regra 4: tudo aqui é derivado on the fly; nada é armazenado.

/** Séries recorrentes ativas num mês (mesInicio <= mk <= mesFim, ou mesFim null). */
export function seriesAtivasNoMes(
  dados: AppData,
  mk: MesKey,
  tipo?: TipoLancamento,
): SerieRecorrente[] {
  return Object.values(dados.series).filter(
    (s) =>
      !s.deleted &&
      (tipo === undefined || s.tipo === tipo) &&
      s.mesInicio <= mk &&
      (s.mesFim === null || s.mesFim >= mk),
  );
}

/** Renda efetiva do mês: soma das séries de entrada ativas. */
export function rendaMes(dados: AppData, mk: MesKey): number {
  return seriesAtivasNoMes(dados, mk, 'entrada').reduce((acc, s) => acc + s.valorCentavos, 0);
}

/** Contas fixas do mês = séries de saída ativas (aluguel, assinatura...). */
export function contasSeriesMes(dados: AppData, mk: MesKey): SerieRecorrente[] {
  return seriesAtivasNoMes(dados, mk, 'saida');
}

/** Contas variáveis do mês = saídas avulsas marcadas como 'conta'. */
export function contasAvulsasMes(dados: AppData, mk: MesKey): Lancamento[] {
  return lancamentosDoMes(dados, mk).filter((l) => l.tipo === 'saida' && l.categoria === 'conta');
}

/**
 * Total das contas do mês, em centavos: contas fixas (séries de saída) + contas
 * variáveis (saídas avulsas 'conta'). É o que se desconta da renda pra formar a
 * sobra livre — contas NUNCA viram evento diário nem deixam o saldo no vermelho.
 */
export function contasDoMes(dados: AppData, mk: MesKey): number {
  const fixas = contasSeriesMes(dados, mk).reduce((acc, s) => acc + s.valorCentavos, 0);
  const variaveis = contasAvulsasMes(dados, mk).reduce((acc, l) => acc + l.valorCentavos, 0);
  return fixas + variaveis;
}

/** Monta o ResumoMes (renda, contas, sobra livre, dias) para um mês. */
export function resumoMesDe(dados: AppData, mk: MesKey): ResumoMes {
  const { ano, mes } = parseMesKey(mk);
  return montarResumoMes(ano, mes, rendaMes(dados, mk), contasDoMes(dados, mk));
}

/** Custo diário médio (float) do mês = sobra livre / dias. Só exibição. */
export function custoDiarioMedio(dados: AppData, mk: MesKey): number {
  const r = resumoMesDe(dados, mk);
  return r.sobraCentavos / r.diasNoMes;
}

/**
 * Um lançamento é "evento diário" (entra no cálculo dia a dia de `domain.ts`)
 * quando é uma entrada (diluída) ou uma saída de GASTO (imediata). Contas
 * (saídas 'conta') ficam de fora — já entram pela sobra livre.
 */
function ehEventoDiario(l: Lancamento): boolean {
  return l.tipo === 'entrada' || l.categoria === 'gasto';
}

/** Mês mais antigo com alguma atividade (lançamento avulso ou série), ou null se não há nada. */
function mesMaisAntigo(dados: AppData): MesKey | null {
  let menor: MesKey | null = null;
  for (const l of Object.values(dados.lancamentos)) {
    if (l.deleted) continue;
    const mk = mesKeyDeData(l.data);
    if (menor === null || mk < menor) menor = mk;
  }
  for (const s of Object.values(dados.series)) {
    if (s.deleted) continue;
    if (menor === null || s.mesInicio < menor) menor = s.mesInicio;
  }
  return menor;
}

/**
 * Saldo inicial de um mês: o saldo acumulado ao final do mês anterior,
 * repetido mês a mês desde o primeiro lançamento/série (rollover contínuo —
 * regra 4: derivado on the fly, nunca guardado). Sem nenhuma atividade antes
 * de `mk`, o saldo inicial é 0.
 */
export function saldoInicialMes(dados: AppData, mk: MesKey): number {
  const anchor = mesMaisAntigo(dados);
  if (anchor === null || mk <= anchor) return 0;

  let saldo = 0;
  for (let m = anchor; m < mk; m = mesSeguinte(m)) {
    // sobra livre já desconta as contas (fixas + avulsas 'conta'); aqui só
    // somamos os eventos diários (entradas avulsas − gastos avulsos), senão
    // as contas seriam contadas duas vezes.
    const sobra = resumoMesDe(dados, m).sobraCentavos;
    let entradas = 0;
    let gastos = 0;
    for (const l of lancamentosDoMes(dados, m)) {
      if (l.tipo === 'entrada') entradas += l.valorCentavos;
      else if (l.categoria === 'gasto') gastos += l.valorCentavos;
    }
    saldo += sobra + entradas - gastos;
  }
  return saldo;
}

/** Calcula o mês inteiro dia a dia (DiaCalculado[]) a partir do AppData. */
export function calcularMesDe(dados: AppData, mk: MesKey): DiaCalculado[] {
  const { ano, mes } = parseMesKey(mk);
  // Só entradas (diluídas) e gastos avulsos (imediatos) viram evento diário;
  // contas entram pela sobra livre do ResumoMes.
  const eventos = Object.values(dados.lancamentos).filter(ehEventoDiario);
  return calcularMes(ano, mes, resumoMesDe(dados, mk), eventos, saldoInicialMes(dados, mk));
}

/** Agregado mensal (totais + dias no vermelho) para o resumo anual. */
export function agregadoMesDe(dados: AppData, mk: MesKey): ResumoMensalAgregado {
  return agregarMes(calcularMesDe(dados, mk));
}

/** Lançamentos avulsos vivos (não deletados) de um mês, ordenados por data. */
export function lancamentosDoMes(dados: AppData, mk: MesKey): Lancamento[] {
  return Object.values(dados.lancamentos)
    .filter((l) => !l.deleted && mesKeyDeData(l.data) === mk)
    .sort((a, b) =>
      a.data < b.data ? -1 : a.data > b.data ? 1 : a.updatedAt < b.updatedAt ? -1 : 1,
    );
}

/**
 * Item da lista "lançamentos do mês": avulso (day-exact) ou série recorrente.
 * `ehConta` = é uma conta do mês (série de saída, ou saída avulsa 'conta') — a
 * UI usa pra agrupar Contas vs Gastos/Entradas.
 */
export type ItemMes = { ehConta: boolean } & (
  | {
      origem: 'avulso';
      id: string;
      tipo: TipoLancamento;
      categoria: CategoriaLancamento;
      valorCentavos: number;
      descricao: string;
      data: ISODate;
    }
  | {
      origem: 'serie';
      id: string;
      tipo: TipoLancamento;
      valorCentavos: number;
      descricao: string;
      serie: SerieRecorrente;
    }
);

/** Lista unificada pra UI: séries ativas no mês (primeiro) + avulsos do mês (por data). */
export function itensDoMes(dados: AppData, mk: MesKey): ItemMes[] {
  const series: ItemMes[] = seriesAtivasNoMes(dados, mk).map((s) => ({
    origem: 'serie',
    id: s.id,
    tipo: s.tipo,
    valorCentavos: s.valorCentavos,
    descricao: s.descricao,
    serie: s,
    ehConta: s.tipo === 'saida', // série de saída = conta fixa
  }));
  const avulsos: ItemMes[] = lancamentosDoMes(dados, mk).map((l) => ({
    origem: 'avulso',
    id: l.id,
    tipo: l.tipo,
    categoria: l.categoria,
    valorCentavos: l.valorCentavos,
    descricao: l.descricao,
    data: l.data,
    ehConta: l.tipo === 'saida' && l.categoria === 'conta',
  }));
  return [...series, ...avulsos];
}
