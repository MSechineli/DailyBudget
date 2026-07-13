import { describe, expect, it } from 'vitest';
import {
  agregarMes,
  budgetAcumCentavos,
  calcularMes,
  montarResumoMes,
  type ResumoMes,
} from './domain.ts';
import type { TipoLancamento } from './schema.ts';

// calcularMes só precisa de data/tipo/valorCentavos (+ deleted opcional).
function lanc(p: {
  data: string;
  tipo: TipoLancamento;
  valorCentavos: number;
  deleted?: boolean;
}) {
  return { deleted: false, ...p };
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

describe('calcularMes — exemplo trabalhado do DOMINIO (saída imediata, entrada diluída)', () => {
  // renda 400000, fixos 100000 → sobra 300000; mês de 30 dias (2026-09).
  // Saída bate CHEIA no dia; entrada é DILUÍDA pelos dias restantes.
  const resumo: ResumoMes = montarResumoMes(2026, 9, 10000);
  const lancamentos = [
    lanc({ data: '2026-09-01', tipo: 'saida', valorCentavos: 25000 }), // imediato: -25000 no dia 1
    lanc({ data: '2026-09-03', tipo: 'entrada', valorCentavos: 15000 }), // diluído: +15000/28 = +535,71/dia
    lanc({ data: '2026-09-04', tipo: 'saida', valorCentavos: 5000 }), // imediato: -5000 no dia 4
  ];
  const dias = calcularMes(2026, 9, resumo, lancamentos);

  it('sobra e dias do resumo', () => {
    expect(resumo.sobraCentavos).toBe(300000);
    expect(resumo.diasNoMes).toBe(30);
    expect(dias).toHaveLength(30);
  });

  it('bate a tabela esperada dia a dia', () => {
    // [entradaDia, saidaDia, saldo, status, diasNoVermelho]
    const esperado: Array<[number, number, number, string, number]> = [
      [0, 25000, -15000, 'vermelho', 2], // saída cheia bate contra budget de 10000
      [0, 0, -5000, 'vermelho', 1], // recupera sozinho: budget acumulou +10000
      [15000, 0, 5536, 'verde', 0], // já verde no dia 3; entrada mal começou a diluir
      [0, 5000, 11071, 'verde', 0],
      [0, 0, 21607, 'verde', 0],
    ];
    esperado.forEach(([ent, sai, saldo, status, dv], i) => {
      const d = dias[i]!;
      expect([d.entradasCentavos, d.saidasCentavos, d.saldoCentavos, d.status, d.diasNoVermelho])
        .toEqual([ent, sai, saldo, status, dv]);
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
  it('saída imediata puxa pro vermelho e o budget diário recupera sozinho com o tempo', () => {
    const resumo = montarResumoMes(2026, 9, 10000); // sobra 300000, taxa base 10000/dia
    const dias = calcularMes(2026, 9, resumo, [
      lanc({ data: '2026-09-01', tipo: 'saida', valorCentavos: 25000 }),
    ]);
    // saída cheia no dia 1: 10000 - 25000 = -15000 → vermelho por 2 dias de custo
    expect(dias[0]!.saldoCentavos).toBe(-15000);
    expect(dias[0]!.status).toBe('vermelho');
    expect(dias[0]!.diasNoVermelho).toBe(2);
    expect(dias[1]!.status).toBe('vermelho'); // dia 2: -5000
    expect(dias[2]!.status).toBe('verde'); // dia 3: +5000, recuperou pelo tempo
    expect(dias.slice(2).every((d) => d.status === 'verde')).toBe(true);
  });

  it('saída grande demais fica vermelha até uma entrada corrigir (entrada diluída)', () => {
    const resumo = montarResumoMes(2026, 9, 10000);
    const dias = calcularMes(2026, 9, resumo, [
      lanc({ data: '2026-09-01', tipo: 'saida', valorCentavos: 310000 }), // > sobra do mês inteiro
      lanc({ data: '2026-09-15', tipo: 'entrada', valorCentavos: 200000 }), // dilui 200000/16 daqui pra frente
    ]);
    expect(dias[0]!.saldoCentavos).toBe(-300000); // 10000 - 310000
    expect(dias[0]!.diasNoVermelho).toBe(30); // 300000 / 10000
    expect(dias[14]!.status).toBe('vermelho'); // dia 15, entrada só começou a diluir
    expect(dias[29]!.saldoCentavos).toBe(190000); // fecha exato: 300000 - 310000 + 200000
    expect(dias.filter((d) => d.status === 'vermelho')).toHaveLength(21);
  });

  it('mesmo dia: saída bate cheia e entrada só começa a diluir', () => {
    const resumo = montarResumoMes(2026, 9, 10000);
    const dias = calcularMes(2026, 9, resumo, [
      lanc({ data: '2026-09-01', tipo: 'saida', valorCentavos: 25000 }),
      lanc({ data: '2026-09-01', tipo: 'entrada', valorCentavos: 20000 }),
    ]);
    // budget d1 = 10000 + 20000/30 (só 1 dia diluído) ≈ 10667; saldo = 10667 - 25000
    expect(dias[0]!.saldoCentavos).toBe(-14333);
    expect(dias[0]!.entradasCentavos).toBe(20000);
    expect(dias[0]!.saidasCentavos).toBe(25000);
    // fecha exato: 300000 + 20000 - 25000
    expect(dias[29]!.saldoCentavos).toBe(295000);
  });

  it('sobra negativa: tudo vermelho e diasNoVermelho = 0', () => {
    const resumo = montarResumoMes(2026, 9, 100000, 120000); // sobra -20000
    const dias = calcularMes(2026, 9, resumo, []);
    expect(dias.every((d) => d.status === 'vermelho')).toBe(true);
    expect(dias.every((d) => d.diasNoVermelho === 0)).toBe(true);
  });

  it('saldo exatamente 0 é verde', () => {
    const resumo = montarResumoMes(2026, 9, 0); // sobra 0, sem lançamentos
    const dias = calcularMes(2026, 9, resumo, []);
    expect(dias.every((d) => d.saldoCentavos === 0)).toBe(true);
    expect(dias.every((d) => d.status === 'verde')).toBe(true);
  });

  it('fevereiro tem 28 dias; ano bissexto 29', () => {
    expect(calcularMes(2026, 2, montarResumoMes(2026, 2, 10000), [])).toHaveLength(28);
    expect(calcularMes(2028, 2, montarResumoMes(2028, 2, 10000), [])).toHaveLength(29);
  });

  it('soft delete não afeta saldo', () => {
    const resumo = montarResumoMes(2026, 9, 10000);
    const dias = calcularMes(2026, 9, resumo, [
      lanc({ data: '2026-09-01', tipo: 'saida', valorCentavos: 25000, deleted: true }),
    ]);
    expect(dias[0]!.saldoCentavos).toBe(10000); // como se não houvesse lançamento
    expect(dias[0]!.saidasCentavos).toBe(0);
  });

  it('data fora do mês é ignorada pelo filtro', () => {
    const resumo = montarResumoMes(2026, 9, 10000);
    const dias = calcularMes(2026, 9, resumo, [
      lanc({ data: '2026-10-01', tipo: 'saida', valorCentavos: 25000 }),
    ]);
    expect(dias[0]!.saidasCentavos).toBe(0);
  });
});

describe('agregarMes (resumo anual)', () => {
  it('soma totais e conta dias no vermelho; saldo final = último dia', () => {
    const resumo = montarResumoMes(2026, 9, 10000);
    const dias = calcularMes(2026, 9, resumo, [
      lanc({ data: '2026-09-01', tipo: 'saida', valorCentavos: 310000 }),
      lanc({ data: '2026-09-15', tipo: 'entrada', valorCentavos: 200000 }),
    ]);
    const ag = agregarMes(dias);
    expect(ag.totalEntradasCentavos).toBe(200000);
    expect(ag.totalSaidasCentavos).toBe(310000);
    expect(ag.saldoFinalCentavos).toBe(190000);
    expect(ag.saldoFinalCentavos).toBe(dias[dias.length - 1]!.saldoCentavos);
    expect(ag.diasNoVermelho).toBe(21);
  });
});

describe('calcularMes — saldoInicialCentavos (rollover imediato do mês anterior)', () => {
  it('sem saldo inicial (padrão), começa do zero', () => {
    const resumo = montarResumoMes(2026, 9, 10000);
    const dias = calcularMes(2026, 9, resumo, []);
    expect(dias[0]!.saldoCentavos).toBe(10000);
  });

  it('rollover positivo aparece CHEIO já no dia 1 (imediato, não diluído)', () => {
    const resumo = montarResumoMes(2026, 9, 10000); // sobra 300000, 30 dias
    const dias = calcularMes(2026, 9, resumo, [], 50000);
    // dia 1 = saldo herdado (50000) + budget do dia (10000)
    expect(dias[0]!.budgetAcumCentavos).toBe(60000);
    expect(dias[0]!.saldoCentavos).toBe(60000);
    expect(dias[29]!.saldoCentavos).toBe(350000); // fecha exato: herdado + sobra
  });

  it('rollover negativo (fechou no vermelho) começa no vermelho e recupera', () => {
    const resumo = montarResumoMes(2026, 9, 10000); // sobra 300000
    const dias = calcularMes(2026, 9, resumo, [], -350000);
    expect(dias[0]!.saldoCentavos).toBe(-340000); // -350000 + 10000
    expect(dias[0]!.status).toBe('vermelho');
    expect(dias[29]!.saldoCentavos).toBe(-50000); // fecha exato: -350000 + 300000
  });

  it('agregarMes propaga o saldo inicial pro saldoFinalCentavos', () => {
    const resumo = montarResumoMes(2026, 9, 10000);
    const dias = calcularMes(2026, 9, resumo, [], 50000);
    expect(agregarMes(dias).saldoFinalCentavos).toBe(350000);
  });
});
