// Regra 1: dinheiro é sempre centavo inteiro. Nunca float.
// Formata pra R$ só na exibição.

/** Formata centavos inteiros como "R$ 1.234,56". */
export function formatBRL(centavos: number): string {
  const sinal = centavos < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(centavos));
  const reais = Math.floor(abs / 100);
  const cents = abs % 100;
  const reaisFmt = reais.toLocaleString('pt-BR');
  return `${sinal}R$ ${reaisFmt},${String(cents).padStart(2, '0')}`;
}

/**
 * Converte texto digitado ("19,90", "19.90", "1990") em centavos inteiros.
 * Retorna null se não der pra interpretar.
 */
export function parseBRLToCentavos(input: string): number | null {
  const limpo = input.trim().replace(/\s/g, '').replace(/R\$/gi, '');
  if (limpo === '') return null;

  // Normaliza separador decimal: vírgula ou ponto valem como decimal.
  // Remove separador de milhar (assume o último separador como decimal).
  const normalizado = limpo.replace(/\./g, ',');
  const partes = normalizado.split(',');
  let inteiro: string;
  let fracao: string;
  if (partes.length === 1) {
    inteiro = partes[0]!;
    fracao = '00';
  } else {
    // Última parte é a fração; o resto junto vira o inteiro.
    fracao = partes.pop()!;
    inteiro = partes.join('');
  }

  if (!/^\d*$/.test(inteiro) || !/^\d*$/.test(fracao)) return null;
  fracao = (fracao + '00').slice(0, 2);
  const centavos = Number(inteiro || '0') * 100 + Number(fracao);
  return Number.isFinite(centavos) ? centavos : null;
}
