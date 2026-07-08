import { describe, expect, it } from 'vitest';
import {
  agregarMes,
  budgetAcumCentavos,
  calcularMes,
  montarResumoMes,
  type ResumoMes,
} from './domain.ts';
import type { Lancamento } from './schema.ts';

function lanc(
  p: Pick<Lancamento, 'data' | 'tipo' | 'valorCentavos'> & Partial<Lancamento>,
): Lancamento {
  return { id: 'x', descricao: '', updatedAt: '2026-01-01T00:00:00.000Z', deleted: false, ...p };
}

describe('budgetAcumCentavos (proporcional, sem drift)', () => {
  it('fecha exato no último dia', () => {
    // sobra 300000, 30 dias
    expect(budgetAcumCentavos(300000, 30, 30)).toBe(300000);
    expect(budgetAcumCentavos(300000, 30, 1)).toBe(10000);
  });

  it('sobra que não divide redondo ainda fecha no último dia', () => {
    // Caso do DOMINIO: sobra 265000, 31 dias (custo médio 8548,38…)
    expect(budgetAcumCentavos(265000, 31, 31)).toBe(265000);
  });
});

describe('calcularMes — exemplo trabalhado do DOMINIO', () => {
  // renda 400000, fixos 100000 → sobra 300000; mês de 30 dias (2026-09).
  const resumo: ResumoMes = montarResumoMes(2026, 9, 400000, 100000);
  const lancamentos: Lancamento[] = [
    lanc({ data: '2026-09-01', tipo: 'saida', valorCentavos: 25000 }),
    lanc({ data: '2026-09-03', tipo: 'entrada', valorCentavos: 15000 }),
    lanc({ data: '2026-09-04', tipo: 'saida', valorCentavos: 5000 }),
  ];
  const dias = calcularMes(2026, 9, resumo, lancamentos);

  it('sobra e dias do resumo', () => {
    expect(resumo.sobraCentavos).toBe(300000);
    expect(resumo.diasNoMes).toBe(30);
    expect(dias).toHaveLength(30);
  });

  it('bate a tabela esperada dia a dia', () => {
    // [budgetAcum, entradaDia, saidaDia, saldo, status, diasNoVermelho]
    const esperado: Array<[number, number, number, number, string, number]> = [
      [10000, 0, 25000, -15000, 'vermelho', 2],
      [20000, 0, 0, -5000, 'vermelho', 1],
      [30000, 15000, 0, 20000, 'verde', 0],
      [40000, 0, 5000, 25000, 'verde', 0],
      [50000, 0, 0, 35000, 'verde', 0],
    ];
    esperado.forEach(([budget, ent, sai, saldo, status, dv], i) => {
      const d = dias[i]!;
      expect([d.budgetAcumCentavos, d.entradasCentavos, d.saidasCentavos, d.saldoCentavos, d.status, d.diasNoVermelho])
        .toEqual([budget, ent, sai, saldo, status, dv]);
    });
  });

  it('dia 30 fecha o mês: budget 300000, saldo 285000', () => {
    const d30 = dias[29]!;
    expect(d30.budgetAcumCentavos).toBe(300000);
    expect(d30.saldoCentavos).toBe(285000);
    expect(d30.status).toBe('verde');
  });

  it('data e dia bem formatados', () => {
    expect(dias[0]!.data).toBe('2026-09-01');
    expect(dias[0]!.dia).toBe(1);
  });
});

describe('calcularMes — casos de borda', () => {
  it('recuperação por tempo: só um gasto no dia 1 volta ao verde no dia 3', () => {
    const resumo = montarResumoMes(2026, 9, 300000, 0); // sobra 300000, 30 dias
    const dias = calcularMes(2026, 9, resumo, [
      lanc({ data: '2026-09-01', tipo: 'saida', valorCentavos: 25000 }),
    ]);
    expect(dias[0]!.status).toBe('vermelho');
    expect(dias[1]!.status).toBe('vermelho');
    expect(dias[2]!.status).toBe('verde');
    expect(dias.slice(2).every((d) => d.status === 'verde')).toBe(true);
  });

  it('recuperação por entrada: entrada no mesmo dia já fica verde', () => {
    const resumo = montarResumoMes(2026, 9, 300000, 0);
    const dias = calcularMes(2026, 9, resumo, [
      lanc({ data: '2026-09-01', tipo: 'saida', valorCentavos: 25000 }),
      lanc({ data: '2026-09-01', tipo: 'entrada', valorCentavos: 20000 }),
    ]);
    // 10000 + 20000 - 25000 = 5000
    expect(dias[0]!.saldoCentavos).toBe(5000);
    expect(dias[0]!.status).toBe('verde');
  });

  it('sobra negativa: tudo vermelho e diasNoVermelho = 0', () => {
    const resumo = montarResumoMes(2026, 9, 100000, 120000); // sobra -20000
    const dias = calcularMes(2026, 9, resumo, []);
    expect(dias.every((d) => d.status === 'vermelho')).toBe(true);
    expect(dias.every((d) => d.diasNoVermelho === 0)).toBe(true);
  });

  it('saldo exatamente 0 é verde', () => {
    const resumo = montarResumoMes(2026, 9, 300000, 0);
    const dias = calcularMes(2026, 9, resumo, [
      lanc({ data: '2026-09-01', tipo: 'saida', valorCentavos: 10000 }), // = budget do dia 1
    ]);
    expect(dias[0]!.saldoCentavos).toBe(0);
    expect(dias[0]!.status).toBe('verde');
  });

  it('fevereiro tem 28 dias; ano bissexto 29', () => {
    expect(calcularMes(2026, 2, montarResumoMes(2026, 2, 100000, 0), [])).toHaveLength(28);
    expect(calcularMes(2028, 2, montarResumoMes(2028, 2, 100000, 0), [])).toHaveLength(29);
  });

  it('soft delete não afeta saldo', () => {
    const resumo = montarResumoMes(2026, 9, 300000, 0);
    const dias = calcularMes(2026, 9, resumo, [
      lanc({ data: '2026-09-01', tipo: 'saida', valorCentavos: 25000, deleted: true }),
    ]);
    expect(dias[0]!.saldoCentavos).toBe(10000); // como se não houvesse lançamento
    expect(dias[0]!.saidasCentavos).toBe(0);
  });

  it('data fora do mês é ignorada pelo filtro', () => {
    const resumo = montarResumoMes(2026, 9, 300000, 0);
    const dias = calcularMes(2026, 9, resumo, [
      lanc({ data: '2026-10-01', tipo: 'saida', valorCentavos: 25000 }),
    ]);
    expect(dias[0]!.saidasCentavos).toBe(0);
  });
});

describe('agregarMes (resumo anual)', () => {
  it('soma totais e conta dias no vermelho; saldo final = último dia', () => {
    const resumo = montarResumoMes(2026, 9, 400000, 100000); // sobra 300000
    const dias = calcularMes(2026, 9, resumo, [
      lanc({ data: '2026-09-01', tipo: 'saida', valorCentavos: 25000 }),
      lanc({ data: '2026-09-03', tipo: 'entrada', valorCentavos: 15000 }),
      lanc({ data: '2026-09-04', tipo: 'saida', valorCentavos: 5000 }),
    ]);
    const ag = agregarMes(dias, resumo);
    expect(ag.totalEntradasCentavos).toBe(15000);
    expect(ag.totalSaidasCentavos).toBe(30000);
    // 300000 + 15000 - 30000 = 285000 = saldo do último dia
    expect(ag.saldoFinalCentavos).toBe(285000);
    expect(ag.saldoFinalCentavos).toBe(dias[dias.length - 1]!.saldoCentavos);
    expect(ag.diasNoVermelho).toBe(2); // dias 1 e 2
  });
});
