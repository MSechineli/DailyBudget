import { describe, expect, it } from 'vitest';
import {
  carteirasVivas,
  diasAteRenda,
  eventosDoMes,
  itensDoMes,
  mediaDiariaGastos,
  previsaoDe,
  projecaoDe,
  saldoAtual,
} from './derive.ts';
import { adicionarDias } from './dates.ts';
import {
  criarDadosVazios,
  type AppData,
  type Carteira,
  type Lancamento,
  type SerieRecorrente,
} from './schema.ts';

const TS = '2026-01-01T00:00:00.000Z';
const HOJE = '2026-07-14';

function cart(p: Partial<Carteira> & { id: string }): Carteira {
  return { nome: p.id, proximaRenda: null, updatedAt: TS, deleted: false, ...p };
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

/** c1: entrada 200000 (07-01) − saída 30000 (07-10), saída FUTURA 99999 (07-20). c2 vazia. */
function base(): AppData {
  const d = criarDadosVazios(2026);
  d.carteiras = {
    c1: cart({ id: 'c1', nome: 'Corrente', proximaRenda: '2026-08-05' }),
    c2: cart({ id: 'c2', nome: 'Vale', proximaRenda: null }),
  };
  d.lancamentos = {
    a: lanc({ id: 'a', carteiraId: 'c1', data: '2026-07-01', tipo: 'entrada', valorCentavos: 200000 }),
    b: lanc({ id: 'b', carteiraId: 'c1', data: '2026-07-10', tipo: 'saida', valorCentavos: 30000 }),
    f: lanc({ id: 'f', carteiraId: 'c1', data: '2026-07-20', tipo: 'saida', valorCentavos: 99999 }),
  };
  return d;
}

describe('carteirasVivas', () => {
  it('ignora deletadas', () => {
    const d = base();
    d.carteiras['c2']!.deleted = true;
    expect(carteirasVivas(d).map((c) => c.id)).toEqual(['c1']);
  });
});

describe('saldoAtual', () => {
  it('soma entradas − saídas com data ≤ hoje (ignora futuro)', () => {
    const d = base();
    expect(saldoAtual(d, 'c1', HOJE)).toBe(170000); // 200000 − 30000 (a saída de 07-20 não conta)
    expect(saldoAtual(d, 'c2', HOJE)).toBe(0); // carteira vazia
  });

  it('inclui as ocorrências de séries até hoje', () => {
    const d = base();
    d.series = {
      s: serie({ id: 's', carteiraId: 'c1', tipo: 'entrada', valorCentavos: 100000, mesInicio: '2026-06', mesFim: null, diaDoMes: 5 }),
    };
    // ocorrências 06-05 e 07-05 (≤ 07-14) → +200000
    expect(saldoAtual(d, 'c1', HOJE)).toBe(170000 + 200000);
  });
});

describe('mediaDiariaGastos', () => {
  it('saídas dos últimos 30 dias ÷ 30', () => {
    const d = base();
    // só a saída de 30000 (07-10) está na janela [06-15, 07-14]
    expect(mediaDiariaGastos(d, 'c1', HOJE)).toBe(30000 / 30);
  });
});

describe('diasAteRenda', () => {
  it('conta os dias até a próxima renda; null se não informada', () => {
    const d = base();
    expect(diasAteRenda(d.carteiras['c1']!, HOJE)).toBe(22); // 07-14 → 08-05
    expect(diasAteRenda(d.carteiras['c2']!, HOJE)).toBeNull();
  });
  it('null se a renda já passou (precisa atualizar)', () => {
    const d = base();
    d.carteiras['c1']!.proximaRenda = '2026-07-01';
    expect(diasAteRenda(d.carteiras['c1']!, HOJE)).toBeNull();
  });
});

describe('previsaoDe', () => {
  it('monta os indicadores da carteira', () => {
    const p = previsaoDe(base(), 'c1', HOJE);
    expect(p.saldoAtualCentavos).toBe(170000);
    expect(p.diasAteRenda).toBe(22);
    expect(p.orcamentoDiarioCentavos).toBe(Math.round(170000 / 22)); // 7727
    expect(p.mediaDiariaCentavos).toBe(1000); // 30000/30
    expect(p.desvioCentavos).toBe(Math.round(1000 - 170000 / 22)); // negativo: abaixo do orçamento
    expect(p.diasQueDura).toBe(170); // 170000 / 1000
    expect(p.folgaDeficitDias).toBe(170 - 22);
    expect(p.dataQueAcaba).toBe(adicionarDias(HOJE, 170));
    expect(p.isf.nivel).toBe('excelente');
  });

  it('carteira sem gastos e sem renda: dura pra sempre, sem orçamento/projeção', () => {
    const p = previsaoDe(base(), 'c2', HOJE);
    expect(p.saldoAtualCentavos).toBe(0);
    expect(p.diasAteRenda).toBeNull();
    expect(p.orcamentoDiarioCentavos).toBeNull();
    expect(p.diasQueDura).toBe(Infinity);
    expect(p.dataQueAcaba).toBeNull();
    expect(p.folgaDeficitDias).toBeNull();
    expect(p.isf.nivel).toBe('excelente');
  });
});

describe('projecaoDe', () => {
  it('duas linhas (real e orçamento) até a próxima renda', () => {
    const proj = projecaoDe(base(), 'c1', HOJE)!;
    expect(proj.dias).toBe(22);
    expect(proj.ritmoReal).toHaveLength(23); // 0..22
    expect(proj.ritmoReal[0]).toBe(170000);
    expect(proj.ritmoReal[22]).toBe(170000 - 1000 * 22); // ritmo real (média)
    expect(proj.ritmoOrcamento[22]).toBe(0); // orçamento fecha em 0 na renda
  });

  it('null quando não há próxima renda', () => {
    expect(projecaoDe(base(), 'c2', HOJE)).toBeNull();
  });
});

describe('eventosDoMes / itensDoMes', () => {
  it('materializa séries datadas e lista o Extrato por data', () => {
    const d = base();
    d.series = {
      s: serie({ id: 's', carteiraId: 'c1', tipo: 'saida', valorCentavos: 5000, mesInicio: '2026-01', mesFim: null, diaDoMes: 20 }),
    };
    expect(eventosDoMes(d, 'c1', '2026-07').some((e) => e.data === '2026-07-20')).toBe(true);
    const itens = itensDoMes(d, 'c1', '2026-07');
    // avulsos 01, 10, 20 + série 20 → ordenados por data
    expect(itens.map((i) => i.data)).toEqual(['2026-07-01', '2026-07-10', '2026-07-20', '2026-07-20']);
  });
});
