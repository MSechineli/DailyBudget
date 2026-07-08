import { describe, expect, it } from 'vitest';
import { validarAppData, ValidationError } from './validate.ts';
import { criarDadosVazios } from './schema.ts';

function comLancamento() {
  const d = criarDadosVazios(2026);
  d.lancamentos['lanc_1'] = {
    id: 'lanc_1',
    data: '2026-01-05',
    tipo: 'saida',
    valorCentavos: 3000,
    descricao: 'mercado',
    updatedAt: '2026-01-05T14:30:00.000Z',
    deleted: false,
  };
  return d;
}

describe('validarAppData', () => {
  it('aceita dados válidos', () => {
    expect(() => validarAppData(comLancamento())).not.toThrow();
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

  it('rejeita id que não bate com a chave do map', () => {
    const d = comLancamento();
    d.lancamentos['outra_chave'] = { ...d.lancamentos['lanc_1']! };
    expect(() => validarAppData(d)).toThrow(/não bate com a chave/);
  });

  it('rejeita chave de mês malformada', () => {
    const d = criarDadosVazios(2026);
    (d.meses as any)['2026-1'] = { rendaOverrideCentavos: null, custosFixosOverride: null };
    expect(() => validarAppData(d)).toThrow(/chave de mês/);
  });

  it('aceita override de mês com valores válidos', () => {
    const d = criarDadosVazios(2026);
    d.meses['2026-02'] = {
      rendaOverrideCentavos: 500000,
      custosFixosOverride: [{ id: 'x', nome: 'X', valorCentavos: 1000 }],
    };
    expect(() => validarAppData(d)).not.toThrow();
  });
});
