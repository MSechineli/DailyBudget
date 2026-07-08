import type { ISODate, MesKey } from './dates.ts';

// Versão atual do schema. Regra 3: bate no JSON desde o commit 1.
// Ao mudar a forma dos dados, incrementa e adiciona um passo em migrate.ts.
// v2: tipos renomeados de gasto/recebido para saida/entrada (DOMINIO.md).
export const SCHEMA_VERSION = 2;

// Entrada = dinheiro que ENTRA; Saída = dinheiro que SAI. valorCentavos é
// sempre positivo — o sinal vem do tipo.
export type TipoLancamento = 'entrada' | 'saida';

export interface CustoFixo {
  id: string;
  nome: string;
  valorCentavos: number;
}

export interface Config {
  ano: number;
  rendaPadraoCentavos: number;
  custosFixosPadrao: CustoFixo[];
}

/** Um mês só existe em `meses` quando tem override; senão herda a config. */
export interface Mes {
  // null = usa rendaPadraoCentavos da config.
  rendaOverrideCentavos: number | null;
  // null = usa custosFixosPadrao; array = substitui só neste mês.
  custosFixosOverride: CustoFixo[] | null;
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

export interface SyncState {
  driveFileId: string | null;
  lastSyncedHash: string | null;
}

export interface AppData {
  version: number;
  config: Config;
  meses: Record<MesKey, Mes>;
  lancamentos: Record<string, Lancamento>;
  sync: SyncState;
}

/** Estado inicial de uma instalação nova. */
export function criarDadosVazios(ano: number): AppData {
  return {
    version: SCHEMA_VERSION,
    config: {
      ano,
      rendaPadraoCentavos: 0,
      custosFixosPadrao: [],
    },
    meses: {},
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
