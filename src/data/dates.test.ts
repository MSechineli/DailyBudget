import { describe, expect, it } from 'vitest';
import {
  diasNoMes,
  isISODateValida,
  mesKeyDeData,
  parseISODate,
  parseMesKey,
  toISODate,
  toMesKey,
} from './dates.ts';

describe('diasNoMes', () => {
  it('conta dias corretos por mês', () => {
    expect(diasNoMes(2026, 1)).toBe(31);
    expect(diasNoMes(2026, 4)).toBe(30);
    expect(diasNoMes(2026, 2)).toBe(28);
  });

  it('trata ano bissexto', () => {
    expect(diasNoMes(2024, 2)).toBe(29);
    expect(diasNoMes(2000, 2)).toBe(29);
    expect(diasNoMes(1900, 2)).toBe(28);
  });
});

describe('formatação de chaves', () => {
  it('toISODate e toMesKey preenchem com zero', () => {
    expect(toISODate(2026, 1, 5)).toBe('2026-01-05');
    expect(toISODate(2026, 12, 31)).toBe('2026-12-31');
    expect(toMesKey(2026, 3)).toBe('2026-03');
  });

  it('mesKeyDeData extrai o mês da data', () => {
    expect(mesKeyDeData('2026-01-05')).toBe('2026-01');
  });

  it('parseMesKey e parseISODate quebram as strings', () => {
    expect(parseMesKey('2026-03')).toEqual({ ano: 2026, mes: 3 });
    expect(parseISODate('2026-03-09')).toEqual({ ano: 2026, mes: 3, dia: 9 });
  });
});

describe('isISODateValida', () => {
  it('aceita datas de calendário reais', () => {
    expect(isISODateValida('2026-01-05')).toBe(true);
    expect(isISODateValida('2024-02-29')).toBe(true); // bissexto
  });

  it('rejeita formato errado ou data inexistente', () => {
    expect(isISODateValida('2026-1-5')).toBe(false);
    expect(isISODateValida('2026-13-01')).toBe(false);
    expect(isISODateValida('2026-02-30')).toBe(false);
    expect(isISODateValida('2025-02-29')).toBe(false); // não bissexto
    expect(isISODateValida('05/01/2026')).toBe(false);
    expect(isISODateValida(20260105 as unknown)).toBe(false);
  });
});
