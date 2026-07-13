import { describe, expect, it } from 'vitest';
import { validarAppData, ValidationError } from './validate.ts';
import { criarDadosVazios } from './schema.ts';

function comLancamento() {
  const d = criarDadosVazios(2026);
  d.lancamentos['lanc_1'] = {
    id: 'lanc_1',
    carteiraId: 'c1',
    data: '2026-01-05',
    tipo: 'saida',
    valorCentavos: 3000,
    descricao: 'mercado',
    updatedAt: '2026-01-05T14:30:00.000Z',
    deleted: false,
  };
  return d;
}

function comSerie() {
  const d = criarDadosVazios(2026);
  d.series['serie_1'] = {
    id: 'serie_1',
    carteiraId: 'c1',
    tipo: 'entrada',
    valorCentavos: 400000,
    descricao: 'Salário',
    diaDoMes: 5,
    mesInicio: '2026-01',
    mesFim: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    deleted: false,
  };
  return d;
}

describe('validarAppData', () => {
  it('aceita dados válidos', () => {
    expect(() => validarAppData(comLancamento())).not.toThrow();
    expect(() => validarAppData(comSerie())).not.toThrow();
  });

  it('rejeita raiz não-objeto', () => {
    expect(() => validarAppData(null)).toThrow(ValidationError);
  });

  it('rejeita valorCentavos não-inteiro (regra: dinheiro é centavo inteiro)', () => {
    const d = comLancamento();
    d.lancamentos['lanc_1']!.valorCentavos = 30.5;
    expect(() => validarAppData(d)).toThrow(/valorCentavos/);
  });

  it('rejeita valorCentavos <= 0 (o sinal vem do tipo)', () => {
    const d = comLancamento();
    d.lancamentos['lanc_1']!.valorCentavos = 0;
    expect(() => validarAppData(d)).toThrow(/valorCentavos/);
    d.lancamentos['lanc_1']!.valorCentavos = -100;
    expect(() => validarAppData(d)).toThrow(/valorCentavos/);
  });

  it('rejeita data em formato inválido', () => {
    const d = comLancamento();
    d.lancamentos['lanc_1']!.data = '05/01/2026';
    expect(() => validarAppData(d)).toThrow(/data/);
  });

  it('rejeita data inexistente no calendário', () => {
    const d = comLancamento();
    d.lancamentos['lanc_1']!.data = '2026-02-30';
    expect(() => validarAppData(d)).toThrow(/data/);
  });

  it('rejeita tipo desconhecido', () => {
    const d = comLancamento();
    (d.lancamentos['lanc_1'] as any).tipo = 'transferencia';
    expect(() => validarAppData(d)).toThrow(/tipo/);
  });

  it('rejeita lançamento sem carteiraId', () => {
    const d = comLancamento();
    delete (d.lancamentos['lanc_1'] as any).carteiraId;
    expect(() => validarAppData(d)).toThrow(/carteiraId/);
  });

  it('rejeita série com diaDoMes fora de 1..31', () => {
    const d = comSerie();
    (d.series['serie_1'] as any).diaDoMes = 40;
    expect(() => validarAppData(d)).toThrow(/diaDoMes/);
  });

  it('rejeita id que não bate com a chave do map', () => {
    const d = comLancamento();
    d.lancamentos['outra_chave'] = { ...d.lancamentos['lanc_1']! };
    expect(() => validarAppData(d)).toThrow(/não bate com a chave/);
  });

  it('rejeita mesInicio em formato inválido', () => {
    const d = comSerie();
    (d.series['serie_1'] as any).mesInicio = '2026-1';
    expect(() => validarAppData(d)).toThrow(/mesInicio/);
  });

  it('rejeita mesFim em formato inválido (quando não-null)', () => {
    const d = comSerie();
    (d.series['serie_1'] as any).mesFim = '2026-2';
    expect(() => validarAppData(d)).toThrow(/mesFim/);
  });

  it('aceita mesFim null (série indefinida)', () => {
    const d = comSerie();
    d.series['serie_1']!.mesFim = null;
    expect(() => validarAppData(d)).not.toThrow();
  });

  it('rejeita mesFim anterior a mesInicio', () => {
    const d = comSerie();
    d.series['serie_1']!.mesInicio = '2026-05';
    d.series['serie_1']!.mesFim = '2026-04';
    expect(() => validarAppData(d)).toThrow(/mesFim/);
  });

  it('rejeita id de série que não bate com a chave do map', () => {
    const d = comSerie();
    d.series['outra_chave'] = { ...d.series['serie_1']! };
    expect(() => validarAppData(d)).toThrow(/não bate com a chave/);
  });
});
