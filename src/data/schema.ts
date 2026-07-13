import type { ISODate, MesKey } from './dates.ts';

// Versão atual do schema. Regra 3: bate no JSON desde o commit 1.
// Ao mudar a forma dos dados, incrementa e adiciona um passo em migrate.ts.
// v2: tipos renomeados de gasto/recebido para saida/entrada (DOMINIO.md).
// v3: remove config de renda/custos fixos "pra sempre"; salário e gastos
// fixos viram séries recorrentes.
// v4: saída avulsa ganha `categoria` (conta vs gasto) — modelo de sobra livre.
// v5: múltiplas CARTEIRAS, cada uma com um valor diário MANUAL. Sai o modelo de
// sobra livre / conta vs gasto: cada lançamento pertence a uma carteira e o
// valor diário é definido pelo usuário. Série ganha `diaDoMes` (vira um
// lançamento recorrente datado). Ver DOMINIO.md.
export const SCHEMA_VERSION = 5;

// Entrada = dinheiro que ENTRA; Saída = dinheiro que SAI. valorCentavos é
// sempre positivo — o sinal vem do tipo.
export type TipoLancamento = 'entrada' | 'saida';

export interface Config {
  ano: number;
}

/**
 * Carteira = uma "conta" independente (Corrente, Investimento, Vale-alimentação…).
 * `valorDiarioCentavos` é o valor diário (daily budget) definido MANUALMENTE pelo
 * usuário — é a base do orçamento diário rolante daquela carteira. Cada carteira
 * tem seu próprio saldo e rollover; lançamentos/séries pertencem a uma carteira.
 */
export interface Carteira {
  id: string;
  nome: string;
  valorDiarioCentavos: number; // valor diário manual (>= 0)
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
export function criarCarteira(nome: string, valorDiarioCentavos = 0): Carteira {
  return {
    id: novoId('cart'),
    nome: nome.trim(),
    valorDiarioCentavos: Math.max(0, Math.round(valorDiarioCentavos)),
    updatedAt: new Date().toISOString(),
    deleted: false,
  };
}

/** Estado inicial de uma instalação nova: uma carteira "Corrente" vazia. */
export function criarDadosVazios(ano: number): AppData {
  const corrente = criarCarteira('Corrente', 0);
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
