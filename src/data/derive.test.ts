import { describe, expect, it } from 'vitest';
import {
  agregadoMesDe,
  calcularMesDe,
  custoDiarioMedio,
  fixosMes,
  itensDoMes,
  lancamentosDoMes,
  rendaMes,
  resumoMesDe,
  saldoInicialMes,
  seriesAtivasNoMes,
  totalFixosMes,
} from './derive.ts';
import { criarDadosVazios, type AppData, type Lancamento, type SerieRecorrente } from './schema.ts';

function serie(
  p: Pick<SerieRecorrente, 'id' | 'tipo' | 'valorCentavos' | 'mesInicio' | 'mesFim'> &
    Partial<SerieRecorrente>,
): SerieRecorrente {
  return { descricao: '', updatedAt: '2026-01-01T00:00:00.000Z', deleted: false, ...p };
}

function base(): AppData {
  const d = criarDadosVazios(2026);
  d.series = {
    salario: serie({
      id: 'salario', tipo: 'entrada', valorCentavos: 400000, mesInicio: '2026-01', mesFim: null,
      descricao: 'Salário',
    }),
    aluguel: serie({
      id: 'aluguel', tipo: 'saida', valorCentavos: 100000, mesInicio: '2026-01', mesFim: null,
      descricao: 'Aluguel',
    }),
  };
  return d;
}

function lanc(
  p: Pick<Lancamento, 'id' | 'data' | 'tipo' | 'valorCentavos'> & Partial<Lancamento>,
): Lancamento {
  return { descricao: '', updatedAt: '2026-01-01T00:00:00.000Z', deleted: false, ...p };
}

describe('seriesAtivasNoMes', () => {
  it('inclui séries indefinidas em qualquer mês a partir de mesInicio', () => {
    const d = base();
    expect(seriesAtivasNoMes(d, '2026-01')).toHaveLength(2);
    expect(seriesAtivasNoMes(d, '2030-06')).toHaveLength(2);
  });

  it('exclui meses antes de mesInicio', () => {
    const d = base();
    expect(seriesAtivasNoMes(d, '2025-12')).toHaveLength(0);
  });

  it('mesFim é inclusive', () => {
    const d = base();
    d.series['aluguel']!.mesFim = '2026-03';
    expect(seriesAtivasNoMes(d, '2026-03', 'saida')).toHaveLength(1);
    expect(seriesAtivasNoMes(d, '2026-04', 'saida')).toHaveLength(0);
  });

  it('ignora séries deletadas', () => {
    const d = base();
    d.series['aluguel']!.deleted = true;
    expect(seriesAtivasNoMes(d, '2026-01', 'saida')).toHaveLength(0);
  });

  it('filtra por tipo', () => {
    const d = base();
    expect(seriesAtivasNoMes(d, '2026-01', 'entrada')).toHaveLength(1);
    expect(seriesAtivasNoMes(d, '2026-01', 'saida')).toHaveLength(1);
  });
});

describe('rendaMes / fixosMes / totalFixosMes', () => {
  it('somam as séries ativas do mês', () => {
    const d = base();
    expect(rendaMes(d, '2026-09')).toBe(400000);
    expect(totalFixosMes(d, '2026-09')).toBe(100000);
    expect(fixosMes(d, '2026-09')).toHaveLength(1);
  });

  it('zero quando não há série ativa', () => {
    const d = criarDadosVazios(2026);
    expect(rendaMes(d, '2026-09')).toBe(0);
    expect(totalFixosMes(d, '2026-09')).toBe(0);
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
    // séries começando no próprio mês testado: sem rollover de meses anteriores
    // interferindo nas contas do exemplo trabalhado (ver DOMINIO.md).
    d.series['salario']!.mesInicio = '2026-09';
    d.series['aluguel']!.mesInicio = '2026-09';
    d.lancamentos = {
      a: lanc({ id: 'a', data: '2026-09-01', tipo: 'saida', valorCentavos: 25000 }),
      b: lanc({ id: 'b', data: '2026-09-03', tipo: 'entrada', valorCentavos: 15000 }),
      c: lanc({ id: 'c', data: '2026-09-04', tipo: 'saida', valorCentavos: 5000 }),
      // outro mês: não deve entrar
      z: lanc({ id: 'z', data: '2026-10-01', tipo: 'saida', valorCentavos: 99999 }),
    };
    const dias = calcularMesDe(d, '2026-09');
    // saída bate cheia no dia; entrada é diluída (mesmos números de domain.test.ts).
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

describe('itensDoMes', () => {
  it('combina séries ativas e avulsos do mês', () => {
    const d = base();
    d.lancamentos = {
      a: lanc({ id: 'a', data: '2026-09-10', tipo: 'saida', valorCentavos: 100, descricao: 'mercado' }),
    };
    const itens = itensDoMes(d, '2026-09');
    expect(itens.filter((i) => i.origem === 'serie')).toHaveLength(2);
    expect(itens.filter((i) => i.origem === 'avulso')).toHaveLength(1);
  });

  it('não inclui séries fora da janela', () => {
    const d = base();
    d.series['aluguel']!.mesFim = '2026-03';
    const itens = itensDoMes(d, '2026-04');
    expect(itens.filter((i) => i.origem === 'serie')).toHaveLength(1);
  });
});

describe('saldoInicialMes (rollover contínuo entre meses)', () => {
  // Fixture própria com atividade começando em setembro (não em janeiro como
  // `base()`), pra manter as contas de "1 mês antes" / "N meses antes" simples.
  function desdeSetembro(): AppData {
    const d = criarDadosVazios(2026);
    d.series = {
      salario: serie({
        id: 'salario', tipo: 'entrada', valorCentavos: 400000, mesInicio: '2026-09', mesFim: null,
      }),
      aluguel: serie({
        id: 'aluguel', tipo: 'saida', valorCentavos: 100000, mesInicio: '2026-09', mesFim: null,
      }),
    };
    return d;
  }

  it('0 quando não há nenhuma atividade antes do mês', () => {
    const d = criarDadosVazios(2026);
    expect(saldoInicialMes(d, '2026-09')).toBe(0);
  });

  it('0 no próprio mês em que a atividade começou (nada "passou" ainda)', () => {
    const d = desdeSetembro();
    expect(saldoInicialMes(d, '2026-09')).toBe(0);
  });

  it('carrega a sobra do mês anterior pro mês seguinte', () => {
    const d = desdeSetembro(); // sobra 300000/mês (renda 400000, aluguel 100000), sem avulsos
    // setembro fecha com saldo 300000; outubro começa com esse valor
    expect(saldoInicialMes(d, '2026-10')).toBe(300000);
  });

  it('acumula por vários meses seguidos', () => {
    const d = desdeSetembro();
    // set + out + nov = 3 meses de sobra 300000 cada = 900000 herdado em dezembro
    expect(saldoInicialMes(d, '2026-12')).toBe(900000);
  });

  it('inclui os avulsos de cada mês no acumulado, não só as séries', () => {
    const d = desdeSetembro();
    d.lancamentos = {
      a: lanc({ id: 'a', data: '2026-09-15', tipo: 'saida', valorCentavos: 20000 }),
    };
    // setembro: 300000 (sobra) - 20000 (avulso) = 280000
    expect(saldoInicialMes(d, '2026-10')).toBe(280000);
  });

  it('calcularMesDe/agregadoMesDe refletem o saldo inicial herdado (imediato no dia 1)', () => {
    const d = desdeSetembro();
    // novembro (30 dias) herda a sobra de set+out = 600000; rollover é imediato,
    // então já aparece cheio no dia 1 + o budget do dia (300000/30 = 10000).
    const dias = calcularMesDe(d, '2026-11');
    expect(dias[0]!.saldoCentavos).toBe(610000); // 600000 herdado + 10000 do dia
    expect(agregadoMesDe(d, '2026-11').saldoFinalCentavos).toBe(600000 + 300000);
  });
});
