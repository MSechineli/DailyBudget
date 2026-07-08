import { get, set } from 'idb-keyval';
import { migrar } from './migrate.ts';
import { criarDadosVazios, type AppData } from './schema.ts';
import { validarAppData } from './validate.ts';

// Regra 5: IndexedDB, não localStorage. E persist() no primeiro uso.
// Regra 7: no load, se o dado corrente falhar, cai pra última revisão boa.

const KEY_ATUAL = 'appData'; // JSON corrente (fonte de verdade local)
const KEY_ULTIMA_BOA = 'appData:lastGood'; // último snapshot que passou na validação

/**
 * Pede persistência do storage pro browser não limpar sob pressão.
 * Best-effort: alguns browsers concedem sem prompt, outros ignoram.
 */
export async function pedirPersistencia(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Roda migração + validação sobre um objeto cru. Lança se inválido. */
function normalizar(cru: unknown): AppData {
  const migrado = migrar(cru);
  validarAppData(migrado);
  return migrado;
}

/**
 * Carrega os dados locais. Se o corrente estiver corrompido, tenta a última
 * revisão boa. Se não houver nada, cria dados vazios para `anoPadrao`.
 * Retorna também de onde veio, pra UI poder avisar sobre recuperação.
 */
export async function carregar(
  anoPadrao: number,
): Promise<{ dados: AppData; origem: 'atual' | 'ultimaBoa' | 'novo' }> {
  const cru = await get(KEY_ATUAL);

  if (cru !== undefined) {
    try {
      const dados = normalizar(cru);
      // Passou: promove a snapshot de segurança.
      await set(KEY_ULTIMA_BOA, dados);
      return { dados, origem: 'atual' };
    } catch (e) {
      console.error('[storage] dados atuais inválidos, tentando última revisão boa:', e);
    }
  }

  const ultimaBoa = await get(KEY_ULTIMA_BOA);
  if (ultimaBoa !== undefined) {
    try {
      const dados = normalizar(ultimaBoa);
      return { dados, origem: 'ultimaBoa' };
    } catch (e) {
      console.error('[storage] última revisão boa também inválida:', e);
    }
  }

  return { dados: criarDadosVazios(anoPadrao), origem: 'novo' };
}

/**
 * Grava os dados localmente. Regra 6: escrita local é sempre garantida —
 * isto nunca espera rede. Também atualiza o snapshot de segurança.
 *
 * Clona para um objeto simples antes de gravar: o `dados` pode vir embrulhado
 * num proxy reativo (Alpine) que o IndexedDB não consegue clonar
 * (DataCloneError). O AppData é 100% JSON-safe por design (centavos inteiros,
 * datas em string), então o round-trip JSON é seguro e desembrulha o proxy.
 */
export async function salvar(dados: AppData): Promise<void> {
  const plano: AppData = JSON.parse(JSON.stringify(dados));
  validarAppData(plano); // valida exatamente o que será gravado
  await set(KEY_ATUAL, plano);
  await set(KEY_ULTIMA_BOA, plano);
}
