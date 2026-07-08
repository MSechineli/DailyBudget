import { describe, expect, it } from 'vitest';
import {
  agregadoMesDe,
  calcularMesDe,
  custoDiarioMedio,
  fixosMes,
  lancamentosDoMes,
  rendaMes,
  resumoMesDe,
  totalFixosMes,
} from './derive.ts';
import { criarDadosVazios, type AppData, type Lancamento } from './schema.ts';

function base(): AppData {
  const d = criarDadosVazios(2026);
  d.config.rendaPadraoCentavos = 400000;
  d.config.custosFixosPadrao = [{ id: 'fx_aluguel', nome: 'Aluguel', valorCentavos: 100000 }];
  return d;
}

function lanc(
  p: Pick<Lancamento, 'id' | 'data' | 'tipo' | 'valorCentavos'> & Partial<Lancamento>,
): Lancamento {
  return { descricao: '', updatedAt: '2026-01-01T00:00:00.000Z', deleted: false, ...p };
}

describe('resolução override vs padrão', () => {
  it('usa o padrão quando não há override', () => {
    const d = base();
    expect(rendaMes(d, '2026-09')).toBe(400000);
    expect(totalFixosMes(d, '2026-09')).toBe(100000);
  });

  it('usa o override do mês quando presente', () => {
    const d = base();
    d.meses['2026-10'] = {
      rendaOverrideCentavos: 500000,
      custosFixosOverride: [{ id: 'x', nome: 'X', valorCentavos: 10000 }],
    };
    expect(rendaMes(d, '2026-10')).toBe(500000);
    expect(totalFixosMes(d, '2026-10')).toBe(10000);
    expect(fixosMes(d, '2026-10')).toHaveLength(1);
  });

  it('override null cai no padrão', () => {
    const d = base();
    d.meses['2026-11'] = { rendaOverrideCentavos: null, custosFixosOverride: null };
    expect(rendaMes(d, '2026-11')).toBe(400000);
    expect(totalFixosMes(d, '2026-11')).toBe(100000);
  });
});

describe('resumoMesDe e custoDiarioMedio', () => {
  it('monta ResumoMes com sobra e dias corretos', () => {
    const d = base();
    const r = resumoMesDe(d, '2026-09'); // 30 dias
    expect(r.sobraCentavos).toBe(300000);
    expect(r.diasNoMes).toBe(30);
    expect(custoDiarioMedio(d, '2026-09')).toBeCloseTo(10000, 6);
  });
});

describe('calcularMesDe / agregadoMesDe', () => {
  it('calcula o mês a partir do AppData (mesmo do exemplo trabalhado)', () => {
    const d = base();
    d.lancamentos = {
      a: lanc({ id: 'a', data: '2026-09-01', tipo: 'saida', valorCentavos: 25000 }),
      b: lanc({ id: 'b', data: '2026-09-03', tipo: 'entrada', valorCentavos: 15000 }),
      c: lanc({ id: 'c', data: '2026-09-04', tipo: 'saida', valorCentavos: 5000 }),
      // outro mês: não deve entrar
      z: lanc({ id: 'z', data: '2026-10-01', tipo: 'saida', valorCentavos: 99999 }),
    };
    const dias = calcularMesDe(d, '2026-09');
    expect(dias[0]!.saldoCentavos).toBe(-15000);
    expect(dias[29]!.saldoCentavos).toBe(285000);

    const ag = agregadoMesDe(d, '2026-09');
    expect(ag.totalSaidasCentavos).toBe(30000);
    expect(ag.diasNoVermelho).toBe(2);
  });
});

describe('lancamentosDoMes', () => {
  it('filtra por mês, ignora deletados e ordena por data', () => {
    const d = base();
    d.lancamentos = {
      a: lanc({ id: 'a', data: '2026-09-10', tipo: 'saida', valorCentavos: 100 }),
      b: lanc({ id: 'b', data: '2026-09-05', tipo: 'saida', valorCentavos: 200 }),
      c: lanc({ id: 'c', data: '2026-10-01', tipo: 'saida', valorCentavos: 300 }),
      x: lanc({ id: 'x', data: '2026-09-08', tipo: 'saida', valorCentavos: 400, deleted: true }),
    };
    expect(lancamentosDoMes(d, '2026-09').map((l) => l.id)).toEqual(['b', 'a']);
  });
});
