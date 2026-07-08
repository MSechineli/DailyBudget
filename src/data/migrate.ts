import { SCHEMA_VERSION, type AppData } from './schema.ts';

// Regra 3: migração no load, sempre. Cada passo leva de version N para N+1.
// Quando o schema mudar: bump SCHEMA_VERSION e adiciona um caso aqui.
//
// Passos recebem/retornam `any` de propósito — cada versão histórica tem uma
// forma diferente e não vale a pena tipar formas antigas mortas.
type PassoMigracao = (dados: any) => any;

const passos: Record<number, PassoMigracao> = {
  // v1 → v2: renomeia tipo de lançamento gasto→saida, recebido→entrada (DOMINIO.md).
  1: (d: any) => ({
    ...d,
    version: 2,
    lancamentos: Object.fromEntries(
      Object.entries(d.lancamentos ?? {}).map(([id, l]: [string, any]) => [
        id,
        {
          ...l,
          tipo: l.tipo === 'recebido' ? 'entrada' : l.tipo === 'gasto' ? 'saida' : l.tipo,
        },
      ]),
    ),
  }),
};

/**
 * Sobe `dados` da version dele até SCHEMA_VERSION, aplicando os passos em ordem.
 * Não valida a forma — isso é papel de validate.ts, chamado depois.
 */
export function migrar(dados: any): AppData {
  if (dados == null || typeof dados !== 'object') {
    throw new Error('Dados inválidos para migração: não é objeto');
  }

  let versao = typeof dados.version === 'number' ? dados.version : 0;
  if (versao > SCHEMA_VERSION) {
    throw new Error(
      `JSON tem version ${versao}, mais nova que a suportada (${SCHEMA_VERSION}). ` +
        `App desatualizado?`,
    );
  }

  let atual = dados;
  while (versao < SCHEMA_VERSION) {
    const passo = passos[versao];
    if (!passo) {
      throw new Error(`Sem passo de migração da version ${versao} para ${versao + 1}`);
    }
    atual = passo(atual);
    versao = atual.version;
  }

  return atual as AppData;
}
