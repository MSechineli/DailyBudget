import { isISODateValida } from './dates.ts';
import type { AppData, Carteira, Config, Lancamento, SerieRecorrente } from './schema.ts';

// Regra 7: validar o JSON no load. Se falhar, o caller cai pra última revisão boa.
// Validação estrutural após a migração — garante que a forma bate com o schema atual.

export class ValidationError extends Error {}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new ValidationError(msg);
}

function isCentavos(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

function isMesKey(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}$/.test(v);
}

function validarConfig(v: unknown): asserts v is Config {
  assert(v && typeof v === 'object', 'config: não é objeto');
  const c = v as Record<string, unknown>;
  assert(typeof c.ano === 'number', 'config.ano inválido');
}

function validarCarteira(v: unknown, ctx: string): asserts v is Carteira {
  assert(v && typeof v === 'object', `${ctx}: não é objeto`);
  const c = v as Record<string, unknown>;
  assert(typeof c.id === 'string' && c.id !== '', `${ctx}.id inválido`);
  assert(typeof c.nome === 'string', `${ctx}.nome inválido`);
  assert(
    c.proximaRenda === null || isISODateValida(c.proximaRenda),
    `${ctx}.proximaRenda inválida (esperado YYYY-MM-DD ou null): ${String(c.proximaRenda)}`,
  );
  assert(typeof c.updatedAt === 'string', `${ctx}.updatedAt inválido`);
  assert(typeof c.deleted === 'boolean', `${ctx}.deleted inválido`);
}

function validarLancamento(v: unknown, ctx: string): asserts v is Lancamento {
  assert(v && typeof v === 'object', `${ctx}: não é objeto`);
  const l = v as Record<string, unknown>;
  assert(typeof l.id === 'string' && l.id !== '', `${ctx}.id inválido`);
  assert(typeof l.carteiraId === 'string' && l.carteiraId !== '', `${ctx}.carteiraId inválido`);
  assert(isISODateValida(l.data), `${ctx}.data inválida (esperado YYYY-MM-DD): ${String(l.data)}`);
  assert(l.tipo === 'entrada' || l.tipo === 'saida', `${ctx}.tipo inválido`);
  assert(
    isCentavos(l.valorCentavos) && l.valorCentavos > 0,
    `${ctx}.valorCentavos deve ser inteiro positivo (o sinal vem do tipo)`,
  );
  assert(typeof l.descricao === 'string', `${ctx}.descricao inválida`);
  assert(typeof l.updatedAt === 'string', `${ctx}.updatedAt inválido`);
  assert(typeof l.deleted === 'boolean', `${ctx}.deleted inválido`);
}

function validarSerie(v: unknown, ctx: string): asserts v is SerieRecorrente {
  assert(v && typeof v === 'object', `${ctx}: não é objeto`);
  const s = v as Record<string, unknown>;
  assert(typeof s.id === 'string' && s.id !== '', `${ctx}.id inválido`);
  assert(typeof s.carteiraId === 'string' && s.carteiraId !== '', `${ctx}.carteiraId inválido`);
  assert(s.tipo === 'entrada' || s.tipo === 'saida', `${ctx}.tipo inválido`);
  assert(
    isCentavos(s.valorCentavos) && s.valorCentavos > 0,
    `${ctx}.valorCentavos deve ser inteiro positivo (o sinal vem do tipo)`,
  );
  assert(typeof s.descricao === 'string', `${ctx}.descricao inválida`);
  assert(
    isCentavos(s.diaDoMes) && (s.diaDoMes as number) >= 1 && (s.diaDoMes as number) <= 31,
    `${ctx}.diaDoMes deve ser inteiro entre 1 e 31`,
  );
  assert(isMesKey(s.mesInicio), `${ctx}.mesInicio inválido (esperado YYYY-MM): ${String(s.mesInicio)}`);
  assert(
    s.mesFim === null || isMesKey(s.mesFim),
    `${ctx}.mesFim inválido (esperado YYYY-MM ou null): ${String(s.mesFim)}`,
  );
  if (s.mesFim !== null) {
    assert((s.mesFim as string) >= (s.mesInicio as string), `${ctx}.mesFim é anterior a mesInicio`);
  }
  assert(typeof s.updatedAt === 'string', `${ctx}.updatedAt inválido`);
  assert(typeof s.deleted === 'boolean', `${ctx}.deleted inválido`);
}

/** Valida a forma completa. Lança ValidationError na primeira falha. */
export function validarAppData(v: unknown): asserts v is AppData {
  assert(v && typeof v === 'object', 'raiz: não é objeto');
  const d = v as Record<string, unknown>;
  assert(typeof d.version === 'number', 'version ausente ou inválida');
  validarConfig(d.config);

  assert(d.carteiras && typeof d.carteiras === 'object', 'carteiras deve ser objeto');
  for (const [k, c] of Object.entries(d.carteiras as object)) {
    validarCarteira(c, `carteiras["${k}"]`);
    assert((c as Carteira).id === k, `carteiras["${k}"].id não bate com a chave`);
  }

  assert(d.series && typeof d.series === 'object', 'series deve ser objeto');
  for (const [k, s] of Object.entries(d.series as object)) {
    validarSerie(s, `series["${k}"]`);
    assert((s as SerieRecorrente).id === k, `series["${k}"].id não bate com a chave`);
  }

  assert(d.lancamentos && typeof d.lancamentos === 'object', 'lancamentos deve ser objeto');
  for (const [k, l] of Object.entries(d.lancamentos as object)) {
    validarLancamento(l, `lancamentos["${k}"]`);
    assert((l as Lancamento).id === k, `lancamentos["${k}"].id não bate com a chave`);
  }

  assert(d.sync && typeof d.sync === 'object', 'sync deve ser objeto');
  const s = d.sync as Record<string, unknown>;
  assert(s.driveFileId === null || typeof s.driveFileId === 'string', 'sync.driveFileId inválido');
  assert(
    s.lastSyncedHash === null || typeof s.lastSyncedHash === 'string',
    'sync.lastSyncedHash inválido',
  );
}
