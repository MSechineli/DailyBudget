// Regra 2: data de calendário é string "YYYY-MM-DD", nunca Date/timestamp.
// BR é UTC-3; usar Date empurraria o gasto pro dia errado.

export type ISODate = string; // "YYYY-MM-DD"
export type MesKey = string; // "YYYY-MM"

/** Hoje no fuso local, como "YYYY-MM-DD". Usa componentes locais, não UTC. */
export function hojeISO(): ISODate {
  const d = new Date();
  return toISODate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** Monta "YYYY-MM-DD" a partir de componentes (mes e dia 1-indexed). */
export function toISODate(ano: number, mes: number, dia: number): ISODate {
  return `${pad4(ano)}-${pad2(mes)}-${pad2(dia)}`;
}

/** "YYYY-MM" de uma data ISO. */
export function mesKeyDeData(data: ISODate): MesKey {
  return data.slice(0, 7);
}

/** Monta "YYYY-MM". */
export function toMesKey(ano: number, mes: number): MesKey {
  return `${pad4(ano)}-${pad2(mes)}`;
}

/** Quebra "YYYY-MM" em { ano, mes } (mes 1-indexed). */
export function parseMesKey(mk: MesKey): { ano: number; mes: number } {
  const [ano, mes] = mk.split('-').map(Number);
  return { ano: ano!, mes: mes! };
}

/** Quebra "YYYY-MM-DD" em { ano, mes, dia }. */
export function parseISODate(data: ISODate): { ano: number; mes: number; dia: number } {
  const [ano, mes, dia] = data.split('-').map(Number);
  return { ano: ano!, mes: mes!, dia: dia! };
}

/** Número de dias no mês (mes 1-indexed). Dia 0 do mês seguinte = último do atual. */
export function diasNoMes(ano: number, mes: number): number {
  return new Date(ano, mes, 0).getDate();
}

/** Valida o formato "YYYY-MM-DD" e se a data existe de fato. */
export function isISODateValida(v: unknown): v is ISODate {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const { ano, mes, dia } = parseISODate(v);
  return mes >= 1 && mes <= 12 && dia >= 1 && dia <= diasNoMes(ano, mes);
}

/** Soma (ou subtrai) `delta` meses a uma MesKey "YYYY-MM". */
export function adicionarMeses(mk: MesKey, delta: number): MesKey {
  const { ano, mes } = parseMesKey(mk);
  const total = ano * 12 + (mes - 1) + delta;
  return toMesKey(Math.floor(total / 12), (total % 12) + 1);
}

/** Mês anterior a `mk`. */
export function mesAnterior(mk: MesKey): MesKey {
  return adicionarMeses(mk, -1);
}

/** Mês seguinte a `mk`. */
export function mesSeguinte(mk: MesKey): MesKey {
  return adicionarMeses(mk, 1);
}

/** Serial de dias (UTC) de uma data ISO — pra diferenças sem timezone/DST. */
function serialDias(data: ISODate): number {
  const { ano, mes, dia } = parseISODate(data);
  return Math.floor(Date.UTC(ano, mes - 1, dia) / 86_400_000);
}

/** Número de dias de `a` até `b` (b − a). Positivo se `b` é depois de `a`. */
export function diasEntre(a: ISODate, b: ISODate): number {
  return serialDias(b) - serialDias(a);
}

/** Soma `n` dias a uma data ISO (n pode ser negativo). */
export function adicionarDias(data: ISODate, n: number): ISODate {
  const { ano, mes, dia } = parseISODate(data);
  const d = new Date(Date.UTC(ano, mes - 1, dia + n));
  return toISODate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
function pad4(n: number): string {
  return String(n).padStart(4, '0');
}
