// Lógica de domínio PURA da PREVISÃO financeira (sem I/O, sem datas — quem
// resolve datas/saldo é derive.ts). Espelha DOMINIO.md. Tudo em centavos.

/** Nível do Índice de Segurança Financeira (ISF). */
export type NivelISF = 'excelente' | 'seguro' | 'atencao' | 'critico' | 'emergencia';

export interface ISF {
  nivel: NivelISF;
  label: string;
}

/**
 * Classifica o ISF pela quantidade de dias que o saldo dura no ritmo atual:
 * 45+ Excelente · 30–44 Seguro · 20–29 Atenção · 10–19 Crítico · 0–9 Emergência.
 * `Infinity` (sem gastos) → Excelente.
 */
export function classificarISF(diasQueDura: number): ISF {
  if (diasQueDura >= 45) return { nivel: 'excelente', label: 'Excelente' };
  if (diasQueDura >= 30) return { nivel: 'seguro', label: 'Seguro' };
  if (diasQueDura >= 20) return { nivel: 'atencao', label: 'Atenção' };
  if (diasQueDura >= 10) return { nivel: 'critico', label: 'Crítico' };
  return { nivel: 'emergencia', label: 'Emergência' };
}

/**
 * Dias que o saldo dura gastando `ritmoDiarioCentavos` por dia. Ritmo ≤ 0
 * (sem gastos) → `Infinity` (o dinheiro não acaba sozinho).
 */
export function diasQueDura(saldoCentavos: number, ritmoDiarioCentavos: number): number {
  if (ritmoDiarioCentavos <= 0) return Infinity;
  return saldoCentavos / ritmoDiarioCentavos;
}
