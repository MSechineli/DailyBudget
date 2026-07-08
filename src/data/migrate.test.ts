import { describe, expect, it } from 'vitest';
import { migrar } from './migrate.ts';
import { criarDadosVazios, SCHEMA_VERSION } from './schema.ts';

describe('migrar', () => {
  it('passa dados na versão atual sem alterar', () => {
    const d = criarDadosVazios(2026);
    expect(migrar(d)).toEqual(d);
    expect(migrar(d).version).toBe(SCHEMA_VERSION);
  });

  it('rejeita não-objeto', () => {
    expect(() => migrar(null)).toThrow();
    expect(() => migrar(42)).toThrow();
  });

  it('rejeita version futura (app desatualizado)', () => {
    expect(() => migrar({ version: SCHEMA_VERSION + 1 })).toThrow(/mais nova/);
  });

  it('falta passo de migração para versão antiga desconhecida', () => {
    // version 0 não tem passo cadastrado (o primeiro passo é 1 → 2).
    expect(() => migrar({ version: 0 })).toThrow(/Sem passo de migração/);
  });

  it('v1 → v2: renomeia tipo gasto→saida e recebido→entrada', () => {
    const v1 = {
      version: 1,
      config: { ano: 2026, rendaPadraoCentavos: 0, custosFixosPadrao: [] },
      meses: {},
      lancamentos: {
        a: {
          id: 'a',
          data: '2026-01-05',
          tipo: 'gasto',
          valorCentavos: 3000,
          descricao: '',
          updatedAt: '2026-01-05T00:00:00.000Z',
          deleted: false,
        },
        b: {
          id: 'b',
          data: '2026-01-06',
          tipo: 'recebido',
          valorCentavos: 5000,
          descricao: '',
          updatedAt: '2026-01-06T00:00:00.000Z',
          deleted: false,
        },
      },
      sync: { driveFileId: null, lastSyncedHash: null },
    };
    const migrado = migrar(v1);
    expect(migrado.version).toBe(SCHEMA_VERSION);
    expect(migrado.lancamentos['a']!.tipo).toBe('saida');
    expect(migrado.lancamentos['b']!.tipo).toBe('entrada');
  });
});
