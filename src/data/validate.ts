import { isISODateValida } from './dates.ts';
import type { AppData, Config, CustoFixo, Lancamento, Mes } from './schema.ts';

// Regra 7: validar o JSON no load. Se falhar, o caller cai pra última revisão boa.
// Validação estrutural após a migração — garante que a forma bate com o schema atual.

export class ValidationError extends Error {}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new ValidationError(msg);
}

function isCentavos(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

function validarCustoFixo(v: unknown, ctx: string): asserts v is CustoFixo {
  assert(v && typeof v === 'object', `${ctx}: não é objeto`);
  const c = v as Record<string, unknown>;
  assert(typeof c.id === 'string' && c.id !== '', `${ctx}.id inválido`);
  assert(typeof c.nome === 'string', `${ctx}.nome inválido`);
  assert(isCentavos(c.valorCentavos), `${ctx}.valorCentavos deve ser inteiro`);
}

function validarConfig(v: unknown): asserts v is Config {
  assert(v && typeof v === 'object', 'config: não é objeto');
  const c = v as Record<string, unknown>;
  assert(typeof c.ano === 'number', 'config.ano inválido');
  assert(isCentavos(c.rendaPadraoCentavos), 'config.rendaPadraoCentavos deve ser inteiro');
  assert(Array.isArray(c.custosFixosPadrao), 'config.custosFixosPadrao deve ser array');
  c.custosFixosPadrao.forEach((f, i) => validarCustoFixo(f, `config.custosFixosPadrao[${i}]`));
}

function validarMes(v: unknown, ctx: string): asserts v is Mes {
  assert(v && typeof v === 'object', `${ctx}: não é objeto`);
  const m = v as Record<string, unknown>;
  assert(
    m.rendaOverrideCentavos === null || isCentavos(m.rendaOverrideCentavos),
    `${ctx}.rendaOverrideCentavos deve ser inteiro ou null`,
  );
  if (m.custosFixosOverride !== null) {
    assert(Array.isArray(m.custosFixosOverride), `${ctx}.custosFixosOverride deve ser array ou null`);
    m.custosFixosOverride.forEach((f, i) => validarCustoFixo(f, `${ctx}.custosFixosOverride[${i}]`));
  }
}

function validarLancamento(v: unknown, ctx: string): asserts v is Lancamento {
  assert(v && typeof v === 'object', `${ctx}: não é objeto`);
  const l = v as Record<string, unknown>;
  assert(typeof l.id === 'string' && l.id !== '', `${ctx}.id inválido`);
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

/** Valida a forma completa. Lança ValidationError na primeira falha. */
export function validarAppData(v: unknown): asserts v is AppData {
  assert(v && typeof v === 'object', 'raiz: não é objeto');
  const d = v as Record<string, unknown>;
  assert(typeof d.version === 'number', 'version ausente ou inválida');
  validarConfig(d.config);

  assert(d.meses && typeof d.meses === 'object', 'meses deve ser objeto');
  for (const [k, m] of Object.entries(d.meses as object)) {
    assert(/^\d{4}-\d{2}$/.test(k), `chave de mês inválida: ${k}`);
    validarMes(m, `meses["${k}"]`);
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
