import type { ISODate, MesKey } from './dates.ts';

// Versão atual do schema. Regra 3: bate no JSON desde o commit 1.
// Ao mudar a forma dos dados, incrementa e adiciona um passo em migrate.ts.
// v2: tipos renomeados de gasto/recebido para saida/entrada (DOMINIO.md).
// v3: remove config de renda/custos fixos "pra sempre"; salário e gastos
// fixos viram séries recorrentes.
// v4: saída avulsa ganha `categoria` (conta vs gasto) — modelo de sobra livre.
// v5: múltiplas CARTEIRAS, cada uma com um valor diário MANUAL.
// v6: sai o valor diário manual; entra a PREVISÃO. A carteira ganha
// `proximaRenda` (data informada da próxima entrada de dinheiro). O orçamento
// diário passa a ser DERIVADO (saldo atual ÷ dias até a próxima renda), junto
// com ISF, data que o dinheiro acaba, folga/déficit. Ver DOMINIO.md.
// v7: sai o campo `proximaRenda`. A "próxima renda" passa a ser DERIVADA da
// próxima ENTRADA futura já cadastrada (ex.: salário recorrente); o dia a dia
// vira um extrato corrido (saldo real dia a dia). Ver DOMINIO.md.
export const SCHEMA_VERSION = 7;

// Entrada = dinheiro que ENTRA; Saída = dinheiro que SAI. valorCentavos é
// sempre positivo — o sinal vem do tipo.
export type TipoLancamento = 'entrada' | 'saida';

export interface Config {
  ano: number;
}

/**
 * Carteira = uma "conta" independente (Corrente, Investimento, Vale-alimentação…).
 * A "próxima renda" NÃO é um campo: é derivada da próxima entrada futura já
 * cadastrada (ver derive.ts). Cada carteira tem seus lançamentos e séries.
 */
export interface Carteira {
  id: string;
  nome: string;
  updatedAt: string;
  deleted: boolean;
}

export interface Lancamento {
  id: string;
  carteiraId: string;
  data: ISODate;
  tipo: TipoLancamento;
  valorCentavos: number;
  descricao: string;
  updatedAt: string; // ISO timestamp (aqui timestamp faz sentido: é metadado de edição)
  deleted: boolean; // soft delete, pra abrir porta a merge item-a-item no futuro
}

/**
 * Lançamento recorrente: mesma entrada/saída todo mês dentro de uma janela
 * [mesInicio, mesFim] (`mesFim: null` = indefinida), na carteira `carteiraId`.
 * Cada mês ativo materializa um lançamento datado em `diaDoMes` (clampado ao
 * tamanho do mês) — passa pela mesma mecânica de um avulso.
 */
export interface SerieRecorrente {
  id: string;
  carteiraId: string;
  tipo: TipoLancamento;
  valorCentavos: number;
  descricao: string;
  diaDoMes: number; // 1..31 (clampado ao tamanho do mês na materialização)
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
  carteiras: Record<string, Carteira>;
  series: Record<string, SerieRecorrente>;
  lancamentos: Record<string, Lancamento>;
  sync: SyncState;
}

/** Cria uma carteira com timestamp/soft-delete padrão. */
export function criarCarteira(nome: string): Carteira {
  return {
    id: novoId('cart'),
    nome: nome.trim(),
    updatedAt: new Date().toISOString(),
    deleted: false,
  };
}

/** Estado inicial de uma instalação nova: uma carteira "Corrente" vazia. */
export function criarDadosVazios(ano: number): AppData {
  const corrente = criarCarteira('Corrente');
  return {
    version: SCHEMA_VERSION,
    config: { ano },
    carteiras: { [corrente.id]: corrente },
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
