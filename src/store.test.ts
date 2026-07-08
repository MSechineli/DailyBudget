import { describe, expect, it } from 'vitest';
import { Store } from './store.ts';
import { criarDadosVazios, type Lancamento } from './data/schema.ts';

// Testa os métodos de mutação do Store isoladamente. Não chama init() (que
// depende de DOM/navigator) — injeta `dados` direto. agendarSalvar usa
// setTimeout e não interfere nas asserções síncronas sobre `dados`.
function store() {
  const s = new Store();
  s.dados = criarDadosVazios(2026);
  return s;
}

function vivos(s: Store): Lancamento[] {
  return Object.values(s.dados.lancamentos).filter((l) => !l.deleted);
}

describe('setValorDia (um valor por dia)', () => {
  it('cria um lançamento quando não existe', () => {
    const s = store();
    s.setValorDia('2026-07-01', 'saida', 25000);
    const v = vivos(s);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ data: '2026-07-01', tipo: 'saida', valorCentavos: 25000 });
  });

  it('atualiza o mesmo dia+tipo em vez de duplicar', () => {
    const s = store();
    s.setValorDia('2026-07-01', 'saida', 25000);
    s.setValorDia('2026-07-01', 'saida', 30000);
    const v = vivos(s);
    expect(v).toHaveLength(1);
    expect(v[0]!.valorCentavos).toBe(30000);
  });

  it('saída e entrada no mesmo dia coexistem', () => {
    const s = store();
    s.setValorDia('2026-07-01', 'saida', 25000);
    s.setValorDia('2026-07-01', 'entrada', 15000);
    expect(vivos(s)).toHaveLength(2);
  });

  it('valor 0 ou null soft-deleta o dia', () => {
    const s = store();
    s.setValorDia('2026-07-01', 'saida', 25000);
    s.setValorDia('2026-07-01', 'saida', 0);
    expect(vivos(s)).toHaveLength(0);
    // o registro continua no map (soft delete), só marcado deleted
    expect(Object.keys(s.dados.lancamentos)).toHaveLength(1);

    s.setValorDia('2026-07-02', 'entrada', 5000);
    s.setValorDia('2026-07-02', 'entrada', null);
    expect(vivos(s)).toHaveLength(0);
  });

  it('recria após soft-delete cria um novo lançamento vivo', () => {
    const s = store();
    s.setValorDia('2026-07-01', 'saida', 25000);
    s.setValorDia('2026-07-01', 'saida', null); // remove
    s.setValorDia('2026-07-01', 'saida', 10000); // volta
    const v = vivos(s);
    expect(v).toHaveLength(1);
    expect(v[0]!.valorCentavos).toBe(10000);
  });

  it('invariante: no máximo 1 lançamento vivo por (data, tipo)', () => {
    const s = store();
    for (const val of [100, 200, 300, 400]) s.setValorDia('2026-07-05', 'saida', val);
    for (const val of [10, 20]) s.setValorDia('2026-07-05', 'entrada', val);
    const chave = (l: Lancamento) => `${l.data}|${l.tipo}`;
    const chaves = vivos(s).map(chave);
    expect(new Set(chaves).size).toBe(chaves.length);
    expect(chaves.sort()).toEqual(['2026-07-05|entrada', '2026-07-05|saida']);
  });
});

describe('config: salário', () => {
  it('setRenda grava o padrão (arredonda e não deixa negativo)', () => {
    const s = store();
    s.setRenda(400000);
    expect(s.dados.config.rendaPadraoCentavos).toBe(400000);
    s.setRenda(-100);
    expect(s.dados.config.rendaPadraoCentavos).toBe(0);
    s.setRenda(123.7);
    expect(s.dados.config.rendaPadraoCentavos).toBe(124);
  });
});

describe('backup: exportar / importar', () => {
  it('exportar devolve um objeto simples (sem proxy) igual aos dados', () => {
    const s = store();
    s.setRenda(400000);
    s.setValorDia('2026-07-01', 'saida', 25000);
    const exp = s.exportar();
    expect(exp.config.rendaPadraoCentavos).toBe(400000);
    expect(exp).not.toBe(s.dados); // é cópia
    expect(JSON.parse(JSON.stringify(s.dados))).toEqual(exp);
  });

  it('importar substitui os dados a partir de um JSON válido', async () => {
    const origem = store();
    origem.setRenda(300000);
    origem.addCustoFixo('Aluguel', 120000);
    origem.setValorDia('2026-07-03', 'entrada', 15000);
    const json = JSON.stringify(origem.exportar());

    const destino = store();
    await destino.importar(json);
    expect(destino.dados.config.rendaPadraoCentavos).toBe(300000);
    expect(destino.dados.config.custosFixosPadrao[0]!.nome).toBe('Aluguel');
    expect(Object.values(destino.dados.lancamentos)).toHaveLength(1);
  });

  it('importar migra JSON de versão antiga (v1 gasto→saida)', async () => {
    const v1 = JSON.stringify({
      version: 1,
      config: { ano: 2026, rendaPadraoCentavos: 0, custosFixosPadrao: [] },
      meses: {},
      lancamentos: {
        a: {
          id: 'a',
          data: '2026-01-05',
          tipo: 'gasto',
          valorCentavos: 3000,
          descricao: '',
          updatedAt: '2026-01-05T00:00:00.000Z',
          deleted: false,
        },
      },
      sync: { driveFileId: null, lastSyncedHash: null },
    });
    const s = store();
    await s.importar(v1);
    expect(s.dados.version).toBe(2);
    expect(s.dados.lancamentos['a']!.tipo).toBe('saida');
  });

  it('importar rejeita JSON malformado', async () => {
    const s = store();
    await expect(s.importar('{ nao é json')).rejects.toThrow();
  });

  it('importar rejeita dados com forma inválida', async () => {
    const s = store();
    // valorCentavos negativo não passa na validação
    const ruim = JSON.stringify({
      version: 2,
      config: { ano: 2026, rendaPadraoCentavos: 0, custosFixosPadrao: [] },
      meses: {},
      lancamentos: {
        a: { id: 'a', data: '2026-01-05', tipo: 'saida', valorCentavos: -1, descricao: '', updatedAt: 'x', deleted: false },
      },
      sync: { driveFileId: null, lastSyncedHash: null },
    });
    await expect(s.importar(ruim)).rejects.toThrow(/valorCentavos/);
  });
});

describe('config: custos fixos', () => {
  it('addCustoFixo retorna id e adiciona ao padrão', () => {
    const s = store();
    const id = s.addCustoFixo('Aluguel', 120000);
    expect(id).toMatch(/^fx_/);
    expect(s.dados.config.custosFixosPadrao).toHaveLength(1);
    expect(s.dados.config.custosFixosPadrao[0]).toMatchObject({
      id,
      nome: 'Aluguel',
      valorCentavos: 120000,
    });
  });

  it('atualizarCustoFixo edita nome e valor', () => {
    const s = store();
    const id = s.addCustoFixo('Aluguel', 120000);
    s.atualizarCustoFixo(id, { nome: 'Aluguel novo', valorCentavos: 130000 });
    expect(s.dados.config.custosFixosPadrao[0]).toMatchObject({
      nome: 'Aluguel novo',
      valorCentavos: 130000,
    });
  });

  it('removerCustoFixo tira do padrão', () => {
    const s = store();
    const id = s.addCustoFixo('Luz', 15000);
    s.addCustoFixo('Água', 8000);
    s.removerCustoFixo(id);
    expect(s.dados.config.custosFixosPadrao.map((f) => f.nome)).toEqual(['Água']);
  });
});
