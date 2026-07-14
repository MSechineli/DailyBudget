import { describe, expect, it } from 'vitest';
import { classificarISF, diasQueDura, projetarSaldos } from './domain.ts';

describe('classificarISF', () => {
  it('classifica pelas faixas de dias que o dinheiro dura', () => {
    expect(classificarISF(60).nivel).toBe('excelente');
    expect(classificarISF(45).nivel).toBe('excelente');
    expect(classificarISF(44).nivel).toBe('seguro');
    expect(classificarISF(30).nivel).toBe('seguro');
    expect(classificarISF(29).nivel).toBe('atencao');
    expect(classificarISF(20).nivel).toBe('atencao');
    expect(classificarISF(19).nivel).toBe('critico');
    expect(classificarISF(10).nivel).toBe('critico');
    expect(classificarISF(9).nivel).toBe('emergencia');
    expect(classificarISF(0).nivel).toBe('emergencia');
  });

  it('Infinity (sem gastos) → Excelente', () => {
    expect(classificarISF(Infinity).nivel).toBe('excelente');
  });

  it('tem rótulo em pt-BR', () => {
    expect(classificarISF(50).label).toBe('Excelente');
    expect(classificarISF(25).label).toBe('Atenção');
    expect(classificarISF(5).label).toBe('Emergência');
  });
});

describe('diasQueDura', () => {
  it('saldo ÷ ritmo diário', () => {
    expect(diasQueDura(100000, 10000)).toBe(10);
    expect(diasQueDura(170000, 1000)).toBe(170);
  });
  it('ritmo 0 ou negativo → Infinity (não acaba sozinho)', () => {
    expect(diasQueDura(100000, 0)).toBe(Infinity);
    expect(diasQueDura(100000, -5)).toBe(Infinity);
  });
});

describe('projetarSaldos', () => {
  it('declina o saldo a um ritmo constante (i = 0..dias)', () => {
    expect(projetarSaldos(200000, 10000, 3)).toEqual([200000, 190000, 180000, 170000]);
  });
  it('arredonda cada ponto (ritmo float)', () => {
    // ritmo 8548,38/dia
    expect(projetarSaldos(100000, 8548.38, 2)).toEqual([100000, 91452, 82903]);
  });
  it('ritmo do orçamento fecha em 0 no dia da renda', () => {
    const saldo = 170000, dias = 22;
    const linha = projetarSaldos(saldo, saldo / dias, dias);
    expect(linha).toHaveLength(dias + 1);
    expect(linha[dias]).toBe(0);
  });
});
