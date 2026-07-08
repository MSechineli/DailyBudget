import { describe, expect, it } from 'vitest';
import { formatBRL, parseBRLToCentavos } from './money.ts';

describe('formatBRL', () => {
  it('formata centavos inteiros com separadores pt-BR', () => {
    expect(formatBRL(0)).toBe('R$ 0,00');
    expect(formatBRL(5)).toBe('R$ 0,05');
    expect(formatBRL(1990)).toBe('R$ 19,90');
    expect(formatBRL(123456)).toBe('R$ 1.234,56');
    expect(formatBRL(100000000)).toBe('R$ 1.000.000,00');
  });

  it('trata valores negativos', () => {
    expect(formatBRL(-1990)).toBe('-R$ 19,90');
    expect(formatBRL(-5)).toBe('-R$ 0,05');
  });
});

describe('parseBRLToCentavos', () => {
  it('aceita vírgula como decimal', () => {
    expect(parseBRLToCentavos('19,90')).toBe(1990);
    expect(parseBRLToCentavos('0,05')).toBe(5);
    expect(parseBRLToCentavos('1.234,56')).toBe(123456); // ponto de milhar
  });

  it('aceita ponto como decimal', () => {
    expect(parseBRLToCentavos('19.90')).toBe(1990);
    expect(parseBRLToCentavos('19.9')).toBe(1990);
  });

  it('aceita inteiro sem decimal', () => {
    expect(parseBRLToCentavos('30')).toBe(3000);
    expect(parseBRLToCentavos('1990')).toBe(199000);
  });

  it('ignora R$ e espaços', () => {
    expect(parseBRLToCentavos('R$ 19,90')).toBe(1990);
    expect(parseBRLToCentavos('  R$1.000,00 ')).toBe(100000);
  });

  it('trunca fração além de 2 casas', () => {
    expect(parseBRLToCentavos('19,999')).toBe(1999);
  });

  it('retorna null para lixo', () => {
    expect(parseBRLToCentavos('')).toBeNull();
    expect(parseBRLToCentavos('abc')).toBeNull();
    expect(parseBRLToCentavos('12,3a')).toBeNull();
  });
});
