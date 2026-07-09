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

describe('calcularMes — exemplo trabalhado do DOMINIO (replanejamento por evento)', () => {
  // renda 400000, fixos 100000 → sobra 300000; mês de 30 dias (2026-09).
  // Cada lançamento é um evento: seu valor é dividido pelos dias restantes do
  // mês A PARTIR do dia em que aconteceu (inclusive), não bate tudo de uma vez.
  const resumo: ResumoMes = montarResumoMes(2026, 9, 400000, 100000);
  const lancamentos: Lancamento[] = [
    lanc({ data: '2026-09-01', tipo: 'saida', valorCentavos: 25000 }), // -25000/30 = -833,33/dia
    lanc({ data: '2026-09-03', tipo: 'entrada', valorCentavos: 15000 }), // +15000/28 = +535,71/dia
    lanc({ data: '2026-09-04', tipo: 'saida', valorCentavos: 5000 }), // -5000/27 = -185,19/dia
  ];
  const dias = calcularMes(2026, 9, resumo, lancamentos);

  it('sobra e dias do resumo', () => {
    expect(resumo.sobraCentavos).toBe(300000);
    expect(resumo.diasNoMes).toBe(30);
    expect(dias).toHaveLength(30);
  });

  it('bate a tabela esperada dia a dia — nenhum lançamento bate de uma vez só', () => {
    // [entradaDia, saidaDia, saldo, status]
    const esperado: Array<[number, number, number, string]> = [
      [0, 25000, 9167, 'verde'],
      [0, 0, 18333, 'verde'],
      [15000, 0, 28036, 'verde'],
      [0, 5000, 37553, 'verde'],
      [0, 0, 47070, 'verde'],
    ];
    esperado.forEach(([ent, sai, saldo, status], i) => {
      const d = dias[i]!;
      expect([d.entradasCentavos, d.saidasCentavos, d.saldoCentavos, d.status]).toEqual([
        ent, sai, saldo, status,
      ]);
    });
  });

  it('dia 30 fecha o mês exato: saldo = sobra + entradas − saídas', () => {
    const d30 = dias[29]!;
    expect(d30.saldoCentavos).toBe(285000); // 300000 + 15000 - 30000
    expect(d30.status).toBe('verde');
  });

  it('data e dia bem formatados', () => {
    expect(dias[0]!.data).toBe('2026-09-01');
    expect(dias[0]!.dia).toBe(1);
  });
});

describe('calcularMes — casos de borda', () => {
  it('replaneja sempre: um gasto grande no dia 1 arrasta o mês pro vermelho até uma entrada corrigir', () => {
    const resumo = montarResumoMes(2026, 9, 300000, 0); // sobra 300000, taxa base 10000/dia, 30 dias
    const dias = calcularMes(2026, 9, resumo, [
      lanc({ data: '2026-09-01', tipo: 'saida', valorCentavos: 310000 }), // maior que a sobra inteira
      lanc({ data: '2026-09-15', tipo: 'entrada', valorCentavos: 200000 }), // corrige a partir daqui
    ]);
    // dia 1: taxa do evento = -310000/30 = -10333,33; 10000 - 10333,33 = -333,33 → vermelho
    expect(dias[0]!.saldoCentavos).toBe(-333);
    expect(dias[0]!.status).toBe('vermelho');
    // sem outra correção, o mês continua caindo (a taxa diária ficou negativa)
    expect(dias[13]!.status).toBe('vermelho'); // dia 14, ainda sem a entrada do dia 15
    // dia 15: a entrada de 200000/16 dias passa a valer, taxa diária volta a ficar positiva
    expect(dias[14]!.saldoCentavos).toBe(7500);
    expect(dias[14]!.status).toBe('verde');
    // e o mês fecha exato: 300000 - 310000 + 200000 = 190000
    expect(dias[29]!.saldoCentavos).toBe(190000);
  });

  it('mesmo dia: entrada e saída se combinam num único evento líquido', () => {
    const resumo = montarResumoMes(2026, 9, 300000, 0);
    const dias = calcularMes(2026, 9, resumo, [
      lanc({ data: '2026-09-01', tipo: 'saida', valorCentavos: 25000 }),
      lanc({ data: '2026-09-01', tipo: 'entrada', valorCentavos: 20000 }),
    ]);
    const soComSaida = calcularMes(2026, 9, resumo, [
      lanc({ data: '2026-09-01', tipo: 'saida', valorCentavos: 5000 }), // líquido: 20000-25000 = -5000
    ]);
    expect(dias[0]!.saldoCentavos).toBe(soComSaida[0]!.saldoCentavos);
  });

  it('sobra negativa: tudo vermelho e diasNoVermelho = 0', () => {
    const resumo = montarResumoMes(2026, 9, 100000, 120000); // sobra -20000
    const dias = calcularMes(2026, 9, resumo, []);
    expect(dias.every((d) => d.status === 'vermelho')).toBe(true);
    expect(dias.every((d) => d.diasNoVermelho === 0)).toBe(true);
  });

  it('saldo exatamente 0 é verde', () => {
    const resumo = montarResumoMes(2026, 9, 0, 0); // sobra 0, sem lançamentos
    const dias = calcularMes(2026, 9, resumo, []);
    expect(dias.every((d) => d.saldoCentavos === 0)).toBe(true);
    expect(dias.every((d) => d.status === 'verde')).toBe(true);
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
    const resumo = montarResumoMes(2026, 9, 300000, 0);
    const dias = calcularMes(2026, 9, resumo, [
      lanc({ data: '2026-09-01', tipo: 'saida', valorCentavos: 310000 }),
      lanc({ data: '2026-09-15', tipo: 'entrada', valorCentavos: 200000 }),
    ]);
    const ag = agregarMes(dias);
    expect(ag.totalEntradasCentavos).toBe(200000);
    expect(ag.totalSaidasCentavos).toBe(310000);
    expect(ag.saldoFinalCentavos).toBe(190000);
    expect(ag.saldoFinalCentavos).toBe(dias[dias.length - 1]!.saldoCentavos);
    expect(ag.diasNoVermelho).toBe(14); // dias 1 a 14, antes da entrada do dia 15
  });
});

describe('calcularMes — saldoInicialCentavos (rollover do mês anterior)', () => {
  it('sem saldo inicial (padrão), comporta-se como antes', () => {
    const resumo = montarResumoMes(2026, 9, 300000, 0);
    const dias = calcularMes(2026, 9, resumo, []);
    expect(dias[0]!.saldoCentavos).toBe(10000);
  });

  it('divide sobra + saldo inicial pelos dias — não aparece inteiro já no dia 1', () => {
    const resumo = montarResumoMes(2026, 9, 300000, 0); // sobra 300000, 30 dias
    const dias = calcularMes(2026, 9, resumo, [], 50000);
    // base 350000 / 30 dias: mesma fórmula proporcional de sempre, só que
    // somando o herdado à sobra ANTES de dividir — não depois.
    expect(dias[0]!.budgetAcumCentavos).toBe(11667); // round(350000*1/30)
    expect(dias[0]!.saldoCentavos).toBe(11667);
    expect(dias[0]!.saldoCentavos).not.toBe(50000); // não é o valor cheio já no dia 1
    expect(dias[29]!.saldoCentavos).toBe(350000); // fecha exato: sobra + herdado
  });

  it('saldo inicial negativo (mês anterior fechou no vermelho) também entra na divisão', () => {
    const resumo = montarResumoMes(2026, 9, 300000, 0); // sobra 300000
    const dias = calcularMes(2026, 9, resumo, [], -350000); // base = -50000
    expect(dias[0]!.saldoCentavos).toBe(Math.round((-50000 * 1) / 30)); // -1667
    expect(dias[0]!.status).toBe('vermelho');
    expect(dias[29]!.saldoCentavos).toBe(-50000); // fecha exato
  });

  it('agregarMes propaga o saldo inicial (já suavizado) pro saldoFinalCentavos', () => {
    const resumo = montarResumoMes(2026, 9, 300000, 0);
    const dias = calcularMes(2026, 9, resumo, [], 50000);
    expect(agregarMes(dias).saldoFinalCentavos).toBe(350000);
  });
});
