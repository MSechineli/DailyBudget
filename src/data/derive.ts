import {
  diasNoMes,
  mesKeyDeData,
  mesSeguinte,
  parseMesKey,
  toISODate,
  type ISODate,
  type MesKey,
} from './dates.ts';
import {
  agregarMes,
  calcularMes,
  montarResumoMes,
  type DiaCalculado,
  type ResumoMensalAgregado,
  type ResumoMes,
} from './domain.ts';
import type { AppData, Carteira, Lancamento, SerieRecorrente, TipoLancamento } from './schema.ts';

// Ponte entre o AppData persistido e o domínio puro (domain.ts). Tudo é POR
// CARTEIRA: cada carteira tem seu valor diário manual (a base do orçamento),
// seus lançamentos e suas séries. Regra 4: derivado on the fly, nada guardado.

// ---- carteiras ----

/** Carteiras vivas (não deletadas), na ordem de inserção. */
export function carteirasVivas(dados: AppData): Carteira[] {
  return Object.values(dados.carteiras).filter((c) => !c.deleted);
}

/** Uma carteira por id (mesmo deletada), ou undefined. */
export function carteira(dados: AppData, carteiraId: string): Carteira | undefined {
  return dados.carteiras[carteiraId];
}

/** Valor diário manual da carteira (centavos). 0 se a carteira não existir. */
export function valorDiario(dados: AppData, carteiraId: string): number {
  return dados.carteiras[carteiraId]?.valorDiarioCentavos ?? 0;
}

// ---- séries e materialização ----

/** Séries ativas de uma carteira num mês (mesInicio <= mk <= mesFim, ou mesFim null). */
export function seriesAtivasNoMes(
  dados: AppData,
  carteiraId: string,
  mk: MesKey,
  tipo?: TipoLancamento,
): SerieRecorrente[] {
  return Object.values(dados.series).filter(
    (s) =>
      !s.deleted &&
      s.carteiraId === carteiraId &&
      (tipo === undefined || s.tipo === tipo) &&
      s.mesInicio <= mk &&
      (s.mesFim === null || s.mesFim >= mk),
  );
}

/** Data (YYYY-MM-DD) da ocorrência de uma série num mês, com o dia clampado. */
export function dataOcorrencia(serie: SerieRecorrente, mk: MesKey): ISODate {
  const { ano, mes } = parseMesKey(mk);
  const dia = Math.min(serie.diaDoMes, diasNoMes(ano, mes));
  return toISODate(ano, mes, dia);
}

/** Lançamentos avulsos vivos de uma carteira num mês, ordenados por data. */
export function lancamentosDoMes(dados: AppData, carteiraId: string, mk: MesKey): Lancamento[] {
  return Object.values(dados.lancamentos)
    .filter((l) => !l.deleted && l.carteiraId === carteiraId && mesKeyDeData(l.data) === mk)
    .sort((a, b) =>
      a.data < b.data ? -1 : a.data > b.data ? 1 : a.updatedAt < b.updatedAt ? -1 : 1,
    );
}

// Só o que o cálculo dia a dia precisa (domain.ts filtra por mês e ignora deletados).
type Evento = Pick<Lancamento, 'data' | 'tipo' | 'valorCentavos'>;

/**
 * Todos os "eventos" que compõem o mês da carteira: os lançamentos avulsos +
 * as séries ativas materializadas como um lançamento datado (em `diaDoMes`).
 * É o input do `calcularMes` (entrada dilui, saída bate na hora).
 */
export function eventosDoMes(dados: AppData, carteiraId: string, mk: MesKey): Evento[] {
  const avulsos: Evento[] = lancamentosDoMes(dados, carteiraId, mk).map((l) => ({
    data: l.data,
    tipo: l.tipo,
    valorCentavos: l.valorCentavos,
  }));
  const recorrentes: Evento[] = seriesAtivasNoMes(dados, carteiraId, mk).map((s) => ({
    data: dataOcorrencia(s, mk),
    tipo: s.tipo,
    valorCentavos: s.valorCentavos,
  }));
  return [...avulsos, ...recorrentes];
}

// ---- resumo / cálculo do mês (por carteira) ----

/** Monta o ResumoMes da carteira: base = valor diário × dias. */
export function resumoMesDe(dados: AppData, carteiraId: string, mk: MesKey): ResumoMes {
  const { ano, mes } = parseMesKey(mk);
  return montarResumoMes(ano, mes, valorDiario(dados, carteiraId));
}

/** Valor diário da carteira (float, pra exibição). Constante no mês. */
export function custoDiarioMedio(dados: AppData, carteiraId: string, mk: MesKey): number {
  const r = resumoMesDe(dados, carteiraId, mk);
  return r.sobraCentavos / r.diasNoMes;
}

/** Mês mais antigo com atividade na carteira (avulso ou série), ou null. */
function mesMaisAntigo(dados: AppData, carteiraId: string): MesKey | null {
  let menor: MesKey | null = null;
  for (const l of Object.values(dados.lancamentos)) {
    if (l.deleted || l.carteiraId !== carteiraId) continue;
    const mk = mesKeyDeData(l.data);
    if (menor === null || mk < menor) menor = mk;
  }
  for (const s of Object.values(dados.series)) {
    if (s.deleted || s.carteiraId !== carteiraId) continue;
    if (menor === null || s.mesInicio < menor) menor = s.mesInicio;
  }
  return menor;
}

/**
 * Saldo inicial de um mês da carteira: saldo acumulado ao final do mês anterior,
 * repetido mês a mês desde a primeira atividade (rollover contínuo, por carteira).
 * Sem atividade antes de `mk`, é 0.
 */
export function saldoInicialMes(dados: AppData, carteiraId: string, mk: MesKey): number {
  const anchor = mesMaisAntigo(dados, carteiraId);
  if (anchor === null || mk <= anchor) return 0;

  let saldo = 0;
  for (let m = anchor; m < mk; m = mesSeguinte(m)) {
    const sobra = resumoMesDe(dados, carteiraId, m).sobraCentavos;
    let entradas = 0;
    let saidas = 0;
    for (const ev of eventosDoMes(dados, carteiraId, m)) {
      if (ev.tipo === 'entrada') entradas += ev.valorCentavos;
      else saidas += ev.valorCentavos;
    }
    saldo += sobra + entradas - saidas;
  }
  return saldo;
}

/** Calcula o mês inteiro dia a dia (DiaCalculado[]) de uma carteira. */
export function calcularMesDe(dados: AppData, carteiraId: string, mk: MesKey): DiaCalculado[] {
  const { ano, mes } = parseMesKey(mk);
  return calcularMes(
    ano,
    mes,
    resumoMesDe(dados, carteiraId, mk),
    eventosDoMes(dados, carteiraId, mk),
    saldoInicialMes(dados, carteiraId, mk),
  );
}

/** Agregado mensal (totais + dias no vermelho) de uma carteira. */
export function agregadoMesDe(dados: AppData, carteiraId: string, mk: MesKey): ResumoMensalAgregado {
  return agregarMes(calcularMesDe(dados, carteiraId, mk));
}

// ---- lista do Extrato ----

/** Item do Extrato: lançamento avulso (day-exact) ou ocorrência de série. */
export type ItemMes = {
  id: string;
  tipo: TipoLancamento;
  valorCentavos: number;
  descricao: string;
  data: ISODate; // avulso: a data; série: a ocorrência daquele mês
} & (
  | { origem: 'avulso' }
  | { origem: 'serie'; serie: SerieRecorrente }
);

/** Lista do Extrato da carteira no mês: avulsos + séries (ocorrência), por data. */
export function itensDoMes(dados: AppData, carteiraId: string, mk: MesKey): ItemMes[] {
  const avulsos: ItemMes[] = lancamentosDoMes(dados, carteiraId, mk).map((l) => ({
    origem: 'avulso',
    id: l.id,
    tipo: l.tipo,
    valorCentavos: l.valorCentavos,
    descricao: l.descricao,
    data: l.data,
  }));
  const recorrentes: ItemMes[] = seriesAtivasNoMes(dados, carteiraId, mk).map((s) => ({
    origem: 'serie',
    id: s.id,
    tipo: s.tipo,
    valorCentavos: s.valorCentavos,
    descricao: s.descricao,
    data: dataOcorrencia(s, mk),
    serie: s,
  }));
  return [...avulsos, ...recorrentes].sort((a, b) =>
    a.data < b.data ? -1 : a.data > b.data ? 1 : 0,
  );
}
