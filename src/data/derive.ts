import { mesKeyDeData, parseMesKey, type MesKey } from './dates.ts';
import {
  agregarMes,
  calcularMes,
  montarResumoMes,
  type DiaCalculado,
  type ResumoMensalAgregado,
  type ResumoMes,
} from './domain.ts';
import type { AppData, CustoFixo, Lancamento } from './schema.ts';

// Ponte entre o AppData persistido e o domínio puro (domain.ts). Resolve
// override-vs-padrão da config e monta os inputs que as funções puras esperam.
// Regra 4: tudo aqui é derivado on the fly; nada é armazenado.

/** Renda efetiva do mês: override do mês ?? padrão da config. */
export function rendaMes(dados: AppData, mk: MesKey): number {
  return dados.meses[mk]?.rendaOverrideCentavos ?? dados.config.rendaPadraoCentavos;
}

/** Custos fixos efetivos do mês: override do mês ?? padrão da config. */
export function fixosMes(dados: AppData, mk: MesKey): CustoFixo[] {
  return dados.meses[mk]?.custosFixosOverride ?? dados.config.custosFixosPadrao;
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

/** Calcula o mês inteiro dia a dia (DiaCalculado[]) a partir do AppData. */
export function calcularMesDe(dados: AppData, mk: MesKey): DiaCalculado[] {
  const { ano, mes } = parseMesKey(mk);
  return calcularMes(ano, mes, resumoMesDe(dados, mk), Object.values(dados.lancamentos));
}

/** Agregado mensal (totais + dias no vermelho) para o resumo anual. */
export function agregadoMesDe(dados: AppData, mk: MesKey): ResumoMensalAgregado {
  return agregarMes(calcularMesDe(dados, mk), resumoMesDe(dados, mk));
}

/** Lançamentos vivos (não deletados) de um mês, ordenados por data. Para a lista da UI. */
export function lancamentosDoMes(dados: AppData, mk: MesKey): Lancamento[] {
  return Object.values(dados.lancamentos)
    .filter((l) => !l.deleted && mesKeyDeData(l.data) === mk)
    .sort((a, b) =>
      a.data < b.data ? -1 : a.data > b.data ? 1 : a.updatedAt < b.updatedAt ? -1 : 1,
    );
}
