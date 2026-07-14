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

  it('v1 → v3: renomeia tipo gasto→saida e recebido→entrada (passa por v2 no caminho)', () => {
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

  describe('v2 → v3: config de renda/custos fixos vira séries recorrentes', () => {
    function v2(config: { rendaPadraoCentavos: number; custosFixosPadrao: any[] }, meses: any = {}) {
      return {
        version: 2,
        config: { ano: 2026, ...config },
        meses,
        lancamentos: {},
        sync: { driveFileId: null, lastSyncedHash: null },
      };
    }

    it('renda padrão vira uma série de entrada indefinida a partir de janeiro do ano', () => {
      const migrado = migrar(v2({ rendaPadraoCentavos: 400000, custosFixosPadrao: [] }));
      expect(migrado.version).toBe(SCHEMA_VERSION);
      expect((migrado as any).meses).toBeUndefined();
      const series = Object.values(migrado.series);
      expect(series).toHaveLength(1);
      expect(series[0]).toMatchObject({
        tipo: 'entrada',
        valorCentavos: 400000,
        mesInicio: '2026-01',
        mesFim: null,
      });
    });

    it('cada custo fixo padrão vira uma série de saída indefinida', () => {
      const migrado = migrar(
        v2({
          rendaPadraoCentavos: 0,
          custosFixosPadrao: [
            { id: 'fx_aluguel', nome: 'Aluguel', valorCentavos: 120000 },
            { id: 'fx_luz', nome: 'Luz', valorCentavos: 15000 },
          ],
        }),
      );
      const series = Object.values(migrado.series);
      expect(series).toHaveLength(2);
      expect(series.map((s: any) => s.descricao).sort()).toEqual(['Aluguel', 'Luz']);
      for (const s of series as any[]) {
        expect(s.tipo).toBe('saida');
        expect(s.mesFim).toBeNull();
      }
    });

    it('sem renda/fixos, migra pra series vazio sem erro', () => {
      const migrado = migrar(v2({ rendaPadraoCentavos: 0, custosFixosPadrao: [] }));
      expect(Object.keys(migrado.series)).toHaveLength(0);
    });

    it('override de mês existente vira uma série de um mês só, truncando a série padrão', () => {
      const migrado = migrar(
        v2(
          { rendaPadraoCentavos: 400000, custosFixosPadrao: [] },
          {
            '2026-06': { rendaOverrideCentavos: 500000, custosFixosOverride: null },
          },
        ),
      );
      const entradas = Object.values(migrado.series).filter((s: any) => s.tipo === 'entrada') as any[];
      // padrão jan-mai, override só em junho, continuação jul em diante
      expect(entradas).toHaveLength(3);
      const porInicio = Object.fromEntries(entradas.map((s) => [s.mesInicio, s]));
      expect(porInicio['2026-01']).toMatchObject({ mesFim: '2026-05', valorCentavos: 400000 });
      expect(porInicio['2026-06']).toMatchObject({ mesFim: '2026-06', valorCentavos: 500000 });
      expect(porInicio['2026-07']).toMatchObject({ mesFim: null, valorCentavos: 400000 });
    });
  });

  describe('v4 → v7: carteiras + previsão', () => {
    it('cria carteira Corrente, move lançamentos/séries, dá diaDoMes e tira categoria', () => {
      const v4 = {
        version: 4,
        config: { ano: 2026 },
        series: {
          s: {
            id: 's', tipo: 'entrada', valorCentavos: 400000, descricao: 'Salário',
            mesInicio: '2026-01', mesFim: null, updatedAt: 'x', deleted: false,
          },
        },
        lancamentos: {
          a: {
            id: 'a', data: '2026-07-05', tipo: 'saida', categoria: 'gasto',
            valorCentavos: 3000, descricao: 'mercado', updatedAt: 'x', deleted: false,
          },
        },
        sync: { driveFileId: null, lastSyncedHash: null },
      };
      const migrado = migrar(v4);
      expect(migrado.version).toBe(SCHEMA_VERSION); // 7

      const carteiraId = Object.keys(migrado.carteiras)[0]!;
      // v4→v5 cria a carteira; v5→v6 põe proximaRenda; v6→v7 remove proximaRenda
      expect(migrado.carteiras[carteiraId]).toMatchObject({ nome: 'Corrente' });
      expect((migrado.carteiras[carteiraId] as any).valorDiarioCentavos).toBeUndefined();
      expect((migrado.carteiras[carteiraId] as any).proximaRenda).toBeUndefined();
      expect(migrado.lancamentos['a']!.carteiraId).toBe(carteiraId);
      expect((migrado.lancamentos['a'] as any).categoria).toBeUndefined();
      expect(migrado.series['s']!.carteiraId).toBe(carteiraId);
      expect(migrado.series['s']!.diaDoMes).toBe(1);
    });
  });

  describe('v5 → v7: valor diário sai; a carteira fica só com o essencial', () => {
    it('remove valorDiarioCentavos e não deixa proximaRenda (removida em v7)', () => {
      const v5 = {
        version: 5,
        config: { ano: 2026 },
        carteiras: {
          c1: { id: 'c1', nome: 'Corrente', valorDiarioCentavos: 8000, updatedAt: 'x', deleted: false },
        },
        series: {},
        lancamentos: {},
        sync: { driveFileId: null, lastSyncedHash: null },
      };
      const migrado = migrar(v5);
      expect(migrado.version).toBe(SCHEMA_VERSION);
      expect((migrado.carteiras['c1'] as any).valorDiarioCentavos).toBeUndefined();
      expect((migrado.carteiras['c1'] as any).proximaRenda).toBeUndefined();
    });
  });

  describe('v6 → v7: remove o campo proximaRenda', () => {
    it('tira proximaRenda de cada carteira (agora é derivada)', () => {
      const v6 = {
        version: 6,
        config: { ano: 2026 },
        carteiras: {
          c1: { id: 'c1', nome: 'Corrente', proximaRenda: '2026-08-05', updatedAt: 'x', deleted: false },
        },
        series: {},
        lancamentos: {},
        sync: { driveFileId: null, lastSyncedHash: null },
      };
      const migrado = migrar(v6);
      expect(migrado.version).toBe(SCHEMA_VERSION);
      expect((migrado.carteiras['c1'] as any).proximaRenda).toBeUndefined();
      expect(migrado.carteiras['c1']).toMatchObject({ id: 'c1', nome: 'Corrente' });
    });
  });
});
