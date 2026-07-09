import { mesKeyDeData, mesSeguinte, parseMesKey, type ISODate, type MesKey } from './dates.ts';
import {
  agregarMes,
  calcularMes,
  montarResumoMes,
  type DiaCalculado,
  type ResumoMensalAgregado,
  type ResumoMes,
} from './domain.ts';
import type { AppData, Lancamento, SerieRecorrente, TipoLancamento } from './schema.ts';

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

/** Custos fixos (séries de saída) ativos no mês. */
export function fixosMes(dados: AppData, mk: MesKey): SerieRecorrente[] {
  return seriesAtivasNoMes(dados, mk, 'saida');
}

/** Soma dos custos fixos do mês, em centavos. */
export function totalFixosMes(dados: AppData, mk: MesKey): number {
  return fixosMes(dados, mk).reduce((acc, f) => acc + f.valorCentavos, 0);
}

/** Monta o ResumoMes (renda, fixos, sobra, dias) para um mês. */
export function resumoMesDe(dados: AppData, mk: MesKey): ResumoMes {
  const { ano, mes } = parseMesKey(mk);
  return montarResumoMes(ano, mes, rendaMes(dados, mk), totalFixosMes(dados, mk));
}

/** Custo diário médio (float) do mês. Só pra exibição; não usar em acumulado. */
export function custoDiarioMedio(dados: AppData, mk: MesKey): number {
  const r = resumoMesDe(dados, mk);
  return r.sobraCentavos / r.diasNoMes;
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
    const sobra = resumoMesDe(dados, m).sobraCentavos;
    let entradas = 0;
    let saidas = 0;
    for (const l of lancamentosDoMes(dados, m)) {
      if (l.tipo === 'entrada') entradas += l.valorCentavos;
      else saidas += l.valorCentavos;
    }
    saldo += sobra + entradas - saidas;
  }
  return saldo;
}

/** Calcula o mês inteiro dia a dia (DiaCalculado[]) a partir do AppData. */
export function calcularMesDe(dados: AppData, mk: MesKey): DiaCalculado[] {
  const { ano, mes } = parseMesKey(mk);
  return calcularMes(
    ano,
    mes,
    resumoMesDe(dados, mk),
    Object.values(dados.lancamentos),
    saldoInicialMes(dados, mk),
  );
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

/** Item da lista "lançamentos do mês": avulso (day-exact) ou série recorrente. */
export type ItemMes =
  | {
      origem: 'avulso';
      id: string;
      tipo: TipoLancamento;
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
    };

/** Lista unificada pra UI: séries ativas no mês (primeiro) + avulsos do mês (por data). */
export function itensDoMes(dados: AppData, mk: MesKey): ItemMes[] {
  const series: ItemMes[] = seriesAtivasNoMes(dados, mk).map((s) => ({
    origem: 'serie',
    id: s.id,
    tipo: s.tipo,
    valorCentavos: s.valorCentavos,
    descricao: s.descricao,
    serie: s,
  }));
  const avulsos: ItemMes[] = lancamentosDoMes(dados, mk).map((l) => ({
    origem: 'avulso',
    id: l.id,
    tipo: l.tipo,
    valorCentavos: l.valorCentavos,
    descricao: l.descricao,
    data: l.data,
  }));
  return [...series, ...avulsos];
}
