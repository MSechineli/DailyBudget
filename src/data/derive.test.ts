import { describe, expect, it } from 'vitest';
import {
  agregadoMesDe,
  calcularMesDe,
  carteirasVivas,
  custoDiarioMedio,
  dataOcorrencia,
  eventosDoMes,
  itensDoMes,
  resumoMesDe,
  saldoInicialMes,
  seriesAtivasNoMes,
  valorDiario,
} from './derive.ts';
import {
  criarDadosVazios,
  type AppData,
  type Carteira,
  type Lancamento,
  type SerieRecorrente,
} from './schema.ts';

const TS = '2026-01-01T00:00:00.000Z';

function cart(p: Partial<Carteira> & { id: string }): Carteira {
  return { nome: p.id, valorDiarioCentavos: 0, updatedAt: TS, deleted: false, ...p };
}
function lanc(
  p: Pick<Lancamento, 'id' | 'carteiraId' | 'data' | 'tipo' | 'valorCentavos'> & Partial<Lancamento>,
): Lancamento {
  return { descricao: '', updatedAt: TS, deleted: false, ...p };
}
function serie(
  p: Pick<SerieRecorrente, 'id' | 'carteiraId' | 'tipo' | 'valorCentavos' | 'mesInicio' | 'mesFim'> &
    Partial<SerieRecorrente>,
): SerieRecorrente {
  return { descricao: '', diaDoMes: 1, updatedAt: TS, deleted: false, ...p };
}

/** Duas carteiras: c1 (valor diário 10000/dia) e c2 (4000/dia). */
function base(): AppData {
  const d = criarDadosVazios(2026);
  d.carteiras = {
    c1: cart({ id: 'c1', nome: 'Corrente', valorDiarioCentavos: 10000 }),
    c2: cart({ id: 'c2', nome: 'Vale', valorDiarioCentavos: 4000 }),
  };
  return d;
}

describe('carteiras / valor diário', () => {
  it('carteirasVivas ignora deletadas', () => {
    const d = base();
    d.carteiras['c2']!.deleted = true;
    expect(carteirasVivas(d).map((c) => c.id)).toEqual(['c1']);
  });

  it('valorDiario e resumo (sobra = valor diário × dias)', () => {
    const d = base();
    expect(valorDiario(d, 'c1')).toBe(10000);
    const r = resumoMesDe(d, 'c1', '2026-09'); // 30 dias
    expect(r.sobraCentavos).toBe(300000);
    expect(r.diasNoMes).toBe(30);
    expect(custoDiarioMedio(d, 'c1', '2026-09')).toBe(10000);
    expect(valorDiario(d, 'c2')).toBe(4000);
  });
});

describe('seriesAtivasNoMes (por carteira)', () => {
  it('filtra por carteira, janela e tipo', () => {
    const d = base();
    d.series = {
      s1: serie({ id: 's1', carteiraId: 'c1', tipo: 'entrada', valorCentavos: 300000, mesInicio: '2026-01', mesFim: null }),
      s2: serie({ id: 's2', carteiraId: 'c2', tipo: 'saida', valorCentavos: 5000, mesInicio: '2026-01', mesFim: '2026-03' }),
    };
    expect(seriesAtivasNoMes(d, 'c1', '2026-09').map((s) => s.id)).toEqual(['s1']);
    expect(seriesAtivasNoMes(d, 'c2', '2026-09')).toHaveLength(0); // fora da janela (mesFim 03)
    expect(seriesAtivasNoMes(d, 'c2', '2026-02').map((s) => s.id)).toEqual(['s2']);
    expect(seriesAtivasNoMes(d, 'c1', '2026-09', 'saida')).toHaveLength(0);
  });
});

describe('eventosDoMes (materializa séries datadas + avulsos)', () => {
  it('dataOcorrencia usa diaDoMes, clampado ao tamanho do mês', () => {
    const s = serie({ id: 's1', carteiraId: 'c1', tipo: 'entrada', valorCentavos: 26000, mesInicio: '2026-01', mesFim: null, diaDoMes: 5 });
    expect(dataOcorrencia(s, '2026-09')).toBe('2026-09-05');
    s.diaDoMes = 31;
    expect(dataOcorrencia(s, '2026-02')).toBe('2026-02-28'); // clampa em fevereiro
  });

  it('série vira um evento datado em diaDoMes', () => {
    const d = base();
    d.series = {
      s1: serie({ id: 's1', carteiraId: 'c1', tipo: 'entrada', valorCentavos: 26000, mesInicio: '2026-01', mesFim: null, diaDoMes: 5 }),
    };
    expect(eventosDoMes(d, 'c1', '2026-09')).toEqual([
      { data: '2026-09-05', tipo: 'entrada', valorCentavos: 26000 },
    ]);
  });

  it('mistura avulsos + séries da mesma carteira', () => {
    const d = base();
    d.series = {
      s1: serie({ id: 's1', carteiraId: 'c1', tipo: 'entrada', valorCentavos: 26000, mesInicio: '2026-01', mesFim: null, diaDoMes: 5 }),
    };
    d.lancamentos = {
      a: lanc({ id: 'a', carteiraId: 'c1', data: '2026-09-10', tipo: 'saida', valorCentavos: 3000 }),
      b: lanc({ id: 'b', carteiraId: 'c2', data: '2026-09-10', tipo: 'saida', valorCentavos: 9999 }), // outra carteira
    };
    const ev = eventosDoMes(d, 'c1', '2026-09');
    expect(ev).toHaveLength(2); // avulso a + série s1; b é de c2
    expect(ev.some((e) => e.valorCentavos === 9999)).toBe(false);
  });
});

describe('calcularMesDe (por carteira, mecânica saída imediata / entrada diluída)', () => {
  it('base valor diário; sem lançamentos fecha em valorDiario × dias', () => {
    const d = base();
    const dias = calcularMesDe(d, 'c1', '2026-09');
    expect(dias[0]!.saldoCentavos).toBe(10000);
    expect(dias[29]!.saldoCentavos).toBe(300000);
  });

  it('saída avulsa bate cheia no dia', () => {
    const d = base();
    d.lancamentos = {
      a: lanc({ id: 'a', carteiraId: 'c1', data: '2026-09-01', tipo: 'saida', valorCentavos: 25000 }),
    };
    const dias = calcularMesDe(d, 'c1', '2026-09');
    expect(dias[0]!.saldoCentavos).toBe(-15000); // 10000 − 25000
  });

  it('série (entrada) materializada entra e fecha exato', () => {
    const d = base();
    d.series = {
      s1: serie({ id: 's1', carteiraId: 'c1', tipo: 'entrada', valorCentavos: 26000, mesInicio: '2026-09', mesFim: null, diaDoMes: 5 }),
    };
    const dias = calcularMesDe(d, 'c1', '2026-09');
    // fecha: 300000 (base) + 26000 (série entrada)
    expect(dias[29]!.saldoCentavos).toBe(326000);
  });

  it('carteiras são isoladas: lançamento de c1 não afeta c2', () => {
    const d = base();
    d.lancamentos = {
      a: lanc({ id: 'a', carteiraId: 'c1', data: '2026-09-01', tipo: 'saida', valorCentavos: 25000 }),
    };
    const diasC2 = calcularMesDe(d, 'c2', '2026-09');
    expect(diasC2[0]!.saldoCentavos).toBe(4000); // só o valor diário de c2
    expect(diasC2[29]!.saldoCentavos).toBe(120000); // 4000 × 30
  });
});

describe('saldoInicialMes (rollover por carteira)', () => {
  it('0 sem atividade anterior (mesmo com valor diário)', () => {
    const d = base();
    expect(saldoInicialMes(d, 'c1', '2026-09')).toBe(0);
  });

  it('carrega o saldo do mês anterior a partir da primeira atividade', () => {
    const d = base();
    d.lancamentos = {
      a: lanc({ id: 'a', carteiraId: 'c1', data: '2026-09-15', tipo: 'saida', valorCentavos: 30000 }),
    };
    // setembro fecha em 300000 − 30000 = 270000 → outubro herda isso
    expect(saldoInicialMes(d, 'c1', '2026-10')).toBe(270000);
    // c2 (sem atividade) segue em 0
    expect(saldoInicialMes(d, 'c2', '2026-10')).toBe(0);
  });

  it('calcularMesDe reflete o saldo inicial herdado (imediato no dia 1)', () => {
    const d = base();
    d.lancamentos = {
      a: lanc({ id: 'a', carteiraId: 'c1', data: '2026-09-15', tipo: 'saida', valorCentavos: 30000 }),
    };
    const dias = calcularMesDe(d, 'c1', '2026-10'); // out: 31 dias, valor diário 10000
    expect(dias[0]!.saldoCentavos).toBe(270000 + 10000);
    expect(agregadoMesDe(d, 'c1', '2026-10').saldoFinalCentavos).toBe(270000 + 310000);
  });
});

describe('itensDoMes (Extrato)', () => {
  it('lista avulsos + ocorrências de série, ordenados por data', () => {
    const d = base();
    d.series = {
      s1: serie({ id: 's1', carteiraId: 'c1', tipo: 'saida', valorCentavos: 5000, mesInicio: '2026-01', mesFim: null, diaDoMes: 20 }),
    };
    d.lancamentos = {
      a: lanc({ id: 'a', carteiraId: 'c1', data: '2026-09-05', tipo: 'saida', valorCentavos: 3000, descricao: 'mercado' }),
      z: lanc({ id: 'z', carteiraId: 'c2', data: '2026-09-01', tipo: 'saida', valorCentavos: 1, descricao: 'outra' }),
    };
    const itens = itensDoMes(d, 'c1', '2026-09');
    expect(itens.map((i) => i.id)).toEqual(['a', 's1']); // 05 antes de 20; c2 fora
    expect(itens[1]!.origem).toBe('serie');
  });
});
