import type { ISODate, MesKey } from './dates.ts';

// Versão atual do schema. Regra 3: bate no JSON desde o commit 1.
// Ao mudar a forma dos dados, incrementa e adiciona um passo em migrate.ts.
// v2: tipos renomeados de gasto/recebido para saida/entrada (DOMINIO.md).
// v3: remove config de renda/custos fixos "pra sempre"; salário e gastos
// fixos viram séries recorrentes (mesma coisa que qualquer outro lançamento,
// só que com uma janela de meses em vez de uma data única).
export const SCHEMA_VERSION = 3;

// Entrada = dinheiro que ENTRA; Saída = dinheiro que SAI. valorCentavos é
// sempre positivo — o sinal vem do tipo.
export type TipoLancamento = 'entrada' | 'saida';

export interface Config {
  ano: number;
}

export interface Lancamento {
  id: string;
  data: ISODate;
  tipo: TipoLancamento;
  valorCentavos: number;
  descricao: string;
  updatedAt: string; // ISO timestamp (aqui timestamp faz sentido: é metadado de edição)
  deleted: boolean; // soft delete, pra abrir porta a merge item-a-item no futuro
}

/**
 * Lançamento recorrente: mesma entrada/saída todo mês dentro de uma janela
 * [mesInicio, mesFim]. `mesFim: null` = indefinida (repete até ser encerrada).
 * O valor entra "suavizado" no orçamento do mês (mesma fórmula de sobra/dia
 * que hoje usava renda/custos fixos da config) — nunca aparece como um
 * lançamento avulso de um dia específico.
 */
export interface SerieRecorrente {
  id: string;
  tipo: TipoLancamento;
  valorCentavos: number;
  descricao: string;
  mesInicio: MesKey; // 'YYYY-MM', primeiro mês em que a série vale
  mesFim: MesKey | null; // inclusive; null = indefinida
  updatedAt: string;
  deleted: boolean; // soft delete
}

export interface SyncState {
  driveFileId: string | null;
  lastSyncedHash: string | null;
}

export interface AppData {
  version: number;
  config: Config;
  series: Record<string, SerieRecorrente>;
  lancamentos: Record<string, Lancamento>;
  sync: SyncState;
}

/** Estado inicial de uma instalação nova. */
export function criarDadosVazios(ano: number): AppData {
  return {
    version: SCHEMA_VERSION,
    config: { ano },
    series: {},
    lancamentos: {},
    sync: {
      driveFileId: null,
      lastSyncedHash: null,
    },
  };
}

let contador = 0;
/** id curto e único o suficiente pra uso pessoal single-user. */
export function novoId(prefixo: string): string {
  contador = (contador + 1) % 1000;
  const rand = Math.random().toString(36).slice(2, 8);
  const t = Date.now().toString(36);
  return `${prefixo}_${t}${rand}${contador}`;
}
