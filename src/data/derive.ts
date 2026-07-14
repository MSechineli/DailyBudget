import {
  adicionarDias,
  diasEntre,
  diasNoMes,
  mesKeyDeData,
  mesSeguinte,
  parseMesKey,
  toISODate,
  type ISODate,
  type MesKey,
} from './dates.ts';
import { classificarISF, diasQueDura, type ISF } from './domain.ts';
import type { AppData, Carteira, Lancamento, SerieRecorrente, TipoLancamento } from './schema.ts';

// Ponte entre o AppData e a previsão. Tudo POR CARTEIRA e "a partir de hoje":
// saldo atual (cumulativo), orçamento diário previsto (saldo ÷ dias até a
// renda), média de gastos, quanto o dinheiro dura, ISF. Regra 4: derivado on
// the fly, nada guardado.

// ---- carteiras ----

export function carteirasVivas(dados: AppData): Carteira[] {
  return Object.values(dados.carteiras).filter((c) => !c.deleted);
}

export function carteira(dados: AppData, carteiraId: string): Carteira | undefined {
  return dados.carteiras[carteiraId];
}

// ---- séries e materialização ----

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

// Só o que a previsão precisa de cada movimento.
type Evento = Pick<Lancamento, 'data' | 'tipo' | 'valorCentavos'>;

/** Eventos do mês: avulsos + séries ativas materializadas (datadas em diaDoMes). */
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

/** Soma dos eventos (por tipo) num intervalo de datas [de, ate], inclusive. */
function somarEventos(
  dados: AppData,
  carteiraId: string,
  de: ISODate,
  ate: ISODate,
): { entradas: number; saidas: number } {
  const anchor = mesMaisAntigo(dados, carteiraId);
  let entradas = 0;
  let saidas = 0;
  if (anchor === null) return { entradas, saidas };
  const mkDe = mesKeyDeData(de) > anchor ? mesKeyDeData(de) : anchor;
  const mkAte = mesKeyDeData(ate);
  for (let m = mkDe; m <= mkAte; m = mesSeguinte(m)) {
    for (const ev of eventosDoMes(dados, carteiraId, m)) {
      if (ev.data < de || ev.data > ate) continue;
      if (ev.tipo === 'entrada') entradas += ev.valorCentavos;
      else saidas += ev.valorCentavos;
    }
  }
  return { entradas, saidas };
}

// ---- indicadores da previsão ----

/** Saldo atual da carteira = Σ(entradas − saídas) de tudo com data ≤ hoje. */
export function saldoAtual(dados: AppData, carteiraId: string, hoje: ISODate): number {
  const { entradas, saidas } = somarEventos(dados, carteiraId, '0000-01-01', hoje);
  return entradas - saidas;
}

/** Janela (em dias) usada pra estimar o ritmo de gastos. */
export const JANELA_MEDIA_DIAS = 30;

/** Média diária de gastos: saídas dos últimos 30 dias ÷ 30. */
export function mediaDiariaGastos(dados: AppData, carteiraId: string, hoje: ISODate): number {
  const de = adicionarDias(hoje, -(JANELA_MEDIA_DIAS - 1));
  const { saidas } = somarEventos(dados, carteiraId, de, hoje);
  return saidas / JANELA_MEDIA_DIAS;
}

/** Quantos meses à frente varrer procurando a próxima entrada futura. */
const HORIZONTE_PROXIMA_ENTRADA_MESES = 24;

/**
 * Próxima renda DERIVADA: a menor data > hoje entre os eventos de tipo
 * `entrada` (avulsos + séries materializadas). Ex.: o salário recorrente. Varre
 * mês a mês a partir do mês de hoje, com teto pra parar quando não há entrada
 * futura (ex.: só saídas cadastradas). Retorna null se não achar nenhuma.
 */
export function proximaEntrada(dados: AppData, carteiraId: string, hoje: ISODate): ISODate | null {
  let mk = mesKeyDeData(hoje);
  for (let i = 0; i < HORIZONTE_PROXIMA_ENTRADA_MESES; i++) {
    let menor: ISODate | null = null;
    for (const ev of eventosDoMes(dados, carteiraId, mk)) {
      if (ev.tipo !== 'entrada' || ev.data <= hoje) continue;
      if (menor === null || ev.data < menor) menor = ev.data;
    }
    if (menor !== null) return menor;
    mk = mesSeguinte(mk);
  }
  return null;
}

/** Dias até a próxima renda derivada; null se não há entrada futura cadastrada. */
export function diasAteRenda(dados: AppData, carteiraId: string, hoje: ISODate): number | null {
  const renda = proximaEntrada(dados, carteiraId, hoje);
  return renda ? diasEntre(hoje, renda) : null;
}

export interface Previsao {
  saldoAtualCentavos: number;
  proximaRenda: ISODate | null;
  diasAteRenda: number | null;
  orcamentoDiarioCentavos: number | null; // saldo ÷ dias até a renda
  mediaDiariaCentavos: number; // últimos 30 dias
  desvioCentavos: number | null; // média − orçamento (positivo = gastando acima)
  diasQueDura: number; // pode ser Infinity (sem gastos)
  dataQueAcaba: ISODate | null; // hoje + diasQueDura (se o dinheiro acaba)
  folgaDeficitDias: number | null; // diasQueDura − dias até a renda
  isf: ISF;
}

/** Monta todos os indicadores de previsão da carteira, "a partir de hoje". */
export function previsaoDe(dados: AppData, carteiraId: string, hoje: ISODate): Previsao {
  const saldo = saldoAtual(dados, carteiraId, hoje);
  const media = mediaDiariaGastos(dados, carteiraId, hoje);
  const renda = proximaEntrada(dados, carteiraId, hoje);
  const dar = renda ? diasEntre(hoje, renda) : null;
  const orcamento = dar !== null ? saldo / dar : null;
  const dur = diasQueDura(saldo, media);
  const dataAcaba = Number.isFinite(dur) && saldo > 0 ? adicionarDias(hoje, Math.floor(dur)) : null;
  return {
    saldoAtualCentavos: saldo,
    proximaRenda: renda,
    diasAteRenda: dar,
    orcamentoDiarioCentavos: orcamento !== null ? Math.round(orcamento) : null,
    mediaDiariaCentavos: Math.round(media),
    desvioCentavos: orcamento !== null ? Math.round(media - orcamento) : null,
    diasQueDura: dur,
    dataQueAcaba: dataAcaba,
    folgaDeficitDias: dar !== null && Number.isFinite(dur) ? Math.round(dur) - dar : null,
    isf: classificarISF(dur),
  };
}

/** Um dia da projeção como extrato corrido: movimento do dia + saldo ao fim dele. */
export interface DiaProjecao {
  data: ISODate;
  gastoCentavos: number; // saídas registradas no dia
  recebidoCentavos: number; // entradas registradas no dia
  saldoCentavos: number; // saldo corrente ao fim do dia
  hoje: boolean;
}

/**
 * Projeção do saldo dia a dia como EXTRATO CORRIDO, de hoje até hoje+dias.
 * Cada dia mostra o gasto/recebido REGISTRADO (avulsos + séries materializadas)
 * e o saldo acumulado — entradas futuras (ex.: salário) aparecem como saltos.
 * Performático: um passe monta o movimento por data; outro acumula o saldo.
 */
export function projecaoLedger(
  dados: AppData,
  carteiraId: string,
  hoje: ISODate,
  dias: number,
): DiaProjecao[] {
  const ate = adicionarDias(hoje, dias);
  // 1) movimento por data no intervalo [hoje, ate], num passe pelos meses.
  const mov = new Map<ISODate, { gasto: number; recebido: number }>();
  const mkAte = mesKeyDeData(ate);
  for (let mk = mesKeyDeData(hoje); mk <= mkAte; mk = mesSeguinte(mk)) {
    for (const ev of eventosDoMes(dados, carteiraId, mk)) {
      if (ev.data < hoje || ev.data > ate) continue;
      const m = mov.get(ev.data) ?? { gasto: 0, recebido: 0 };
      if (ev.tipo === 'entrada') m.recebido += ev.valorCentavos;
      else m.gasto += ev.valorCentavos;
      mov.set(ev.data, m);
    }
  }
  // 2) saldo corrente: começa no saldo atual (já inclui tudo ≤ hoje) e acumula
  // só os dias FUTUROS (o movimento de hoje já está embutido no saldo atual).
  const out: DiaProjecao[] = [];
  let saldo = saldoAtual(dados, carteiraId, hoje);
  for (let i = 0; i <= dias; i++) {
    const data = adicionarDias(hoje, i);
    const m = mov.get(data) ?? { gasto: 0, recebido: 0 };
    if (i > 0) saldo += m.recebido - m.gasto;
    out.push({
      data,
      gastoCentavos: m.gasto,
      recebidoCentavos: m.recebido,
      saldoCentavos: saldo,
      hoje: i === 0,
    });
  }
  return out;
}

// ---- lista do Extrato ----

export type ItemMes = {
  id: string;
  tipo: TipoLancamento;
  valorCentavos: number;
  descricao: string;
  data: ISODate; // avulso: a data; série: a ocorrência daquele mês
} & ({ origem: 'avulso' } | { origem: 'serie'; serie: SerieRecorrente });

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
  return [...avulsos, ...recorrentes].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
}
