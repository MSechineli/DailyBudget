import { clear, get, set } from 'idb-keyval';
import { afterEach, describe, expect, it } from 'vitest';
import { carregar, salvar } from './storage.ts';
import { criarDadosVazios, SCHEMA_VERSION } from './schema.ts';

const KEY_ATUAL = 'appData';
const KEY_ULTIMA_BOA = 'appData:lastGood';

afterEach(async () => {
  await clear();
});

describe('carregar', () => {
  it('cria dados vazios quando não há nada', async () => {
    const { dados, origem } = await carregar(2026);
    expect(origem).toBe('novo');
    expect(dados.version).toBe(SCHEMA_VERSION);
    expect(dados.config.ano).toBe(2026);
  });

  it('faz round-trip do que foi salvo', async () => {
    const d = criarDadosVazios(2026);
    d.series['s1'] = {
      id: 's1', carteiraId: 'c1', tipo: 'entrada', valorCentavos: 400000, descricao: 'Salário',
      diaDoMes: 5, mesInicio: '2026-01', mesFim: null, updatedAt: '2026-01-01T00:00:00.000Z', deleted: false,
    };
    await salvar(d);

    const { dados, origem } = await carregar(2026);
    expect(origem).toBe('atual');
    expect(dados.series['s1']!.valorCentavos).toBe(400000);
  });

  it('salvar promove o snapshot de última revisão boa', async () => {
    const d = criarDadosVazios(2026);
    await salvar(d);
    expect(await get(KEY_ULTIMA_BOA)).toBeDefined();
  });

  it('cai pra última revisão boa quando o atual está corrompido', async () => {
    // Snapshot bom salvo antes.
    const bom = criarDadosVazios(2026);
    bom.series['s1'] = {
      id: 's1', carteiraId: 'c1', tipo: 'entrada', valorCentavos: 123456, descricao: 'Salário',
      diaDoMes: 5, mesInicio: '2026-01', mesFim: null, updatedAt: '2026-01-01T00:00:00.000Z', deleted: false,
    };
    await set(KEY_ULTIMA_BOA, bom);

    // Atual corrompido (valorCentavos float não passa na validação).
    await set(KEY_ATUAL, {
      version: 1,
      config: { ano: 2026, rendaPadraoCentavos: 12.5, custosFixosPadrao: [] },
      meses: {},
      lancamentos: {},
      sync: { driveFileId: null, lastSyncedHash: null },
    });

    const { dados, origem } = await carregar(2026);
    expect(origem).toBe('ultimaBoa');
    expect(dados.series['s1']!.valorCentavos).toBe(123456);
  });

  it('cai pra dados novos quando atual e última boa estão corrompidos', async () => {
    await set(KEY_ATUAL, { version: 1, lixo: true });
    await set(KEY_ULTIMA_BOA, { version: 1, tambemLixo: true });

    const { origem } = await carregar(2026);
    expect(origem).toBe('novo');
  });
});

describe('salvar', () => {
  it('recusa gravar dados inválidos', async () => {
    const ruim = criarDadosVazios(2026);
    (ruim.config as any).ano = '2026';
    await expect(salvar(ruim)).rejects.toThrow();
  });
});
