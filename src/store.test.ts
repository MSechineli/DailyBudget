import { describe, expect, it } from 'vitest';
import { Store } from './store.ts';
import { criarDadosVazios, type Lancamento, type SerieRecorrente } from './data/schema.ts';

// Testa os métodos de mutação do Store isoladamente. Não chama init() (que
// depende de DOM/navigator) — injeta `dados` direto e aponta a carteira ativa
// pra carteira "Corrente" criada por criarDadosVazios.
function store() {
  const s = new Store();
  s.dados = criarDadosVazios(2026);
  s.carteiraAtualId = Object.keys(s.dados.carteiras)[0]!;
  return s;
}

function vivos(s: Store): Lancamento[] {
  return Object.values(s.dados.lancamentos).filter((l) => !l.deleted);
}
function seriesVivas(s: Store): SerieRecorrente[] {
  return Object.values(s.dados.series).filter((x) => !x.deleted);
}

describe('carteiras: CRUD', () => {
  it('adicionarCarteira cria e foca na nova', () => {
    const s = store();
    const c = s.adicionarCarteira('Vale-alimentação', '2026-08-05');
    expect(c.proximaRenda).toBe('2026-08-05');
    expect(s.carteiraAtualId).toBe(c.id); // foca na nova
    expect(Object.values(s.dados.carteiras).filter((x) => !x.deleted)).toHaveLength(2);
  });

  it('atualizarCarteira edita nome e próxima renda', () => {
    const s = store();
    const id = s.carteiraAtualId;
    s.atualizarCarteira(id, { nome: 'Conta Corrente', proximaRenda: '2026-09-05' });
    expect(s.dados.carteiras[id]).toMatchObject({ nome: 'Conta Corrente', proximaRenda: '2026-09-05' });
    s.atualizarCarteira(id, { proximaRenda: null });
    expect(s.dados.carteiras[id]!.proximaRenda).toBeNull();
  });

  it('removerCarteira soft-deleta e troca a ativa; nunca remove a última', () => {
    const s = store();
    const c1 = s.carteiraAtualId;
    const c2 = s.adicionarCarteira('Vale').id;
    s.irParaCarteira(c2);
    s.removerCarteira(c2);
    expect(s.dados.carteiras[c2]!.deleted).toBe(true);
    expect(s.carteiraAtualId).toBe(c1); // volta pra viva
    // agora só resta c1 — não pode remover
    s.removerCarteira(c1);
    expect(s.dados.carteiras[c1]!.deleted).toBe(false);
  });
});

describe('lançamentos avulsos', () => {
  it('herda a carteira ativa e permite vários no mesmo dia+tipo', () => {
    const s = store();
    s.adicionarLancamento({ data: '2026-07-01', tipo: 'saida', valorCentavos: 100, descricao: 'mercado' });
    s.adicionarLancamento({ data: '2026-07-01', tipo: 'saida', valorCentavos: 200, descricao: 'uber' });
    expect(vivos(s)).toHaveLength(2);
    expect(vivos(s).every((l) => l.carteiraId === s.carteiraAtualId)).toBe(true);
  });

  it('atualizar edita; soft delete remove', () => {
    const s = store();
    const l = s.adicionarLancamento({ data: '2026-07-01', tipo: 'saida', valorCentavos: 100, descricao: 'x' });
    s.atualizarLancamento(l.id, { valorCentavos: 200 });
    expect(s.dados.lancamentos[l.id]!.valorCentavos).toBe(200);
    s.removerLancamento(l.id);
    expect(vivos(s)).toHaveLength(0);
  });
});

describe('adicionarLancamentoComRecorrencia', () => {
  it('nenhuma → avulso na carteira ativa', () => {
    const s = store();
    s.adicionarLancamentoComRecorrencia({
      data: '2026-07-05', tipo: 'saida', valorCentavos: 3000, descricao: 'mercado', recorrencia: 'nenhuma',
    });
    expect(vivos(s)).toHaveLength(1);
    expect(seriesVivas(s)).toHaveLength(0);
    expect(vivos(s)[0]!.carteiraId).toBe(s.carteiraAtualId);
  });

  it('N meses → série com diaDoMes = dia da data, mesFim inclusive', () => {
    const s = store();
    s.adicionarLancamentoComRecorrencia({
      data: '2026-07-05', tipo: 'saida', valorCentavos: 1200, descricao: 'aluguel', recorrencia: { meses: 3 },
    });
    const serie = seriesVivas(s)[0]!;
    expect(serie).toMatchObject({
      carteiraId: s.carteiraAtualId,
      diaDoMes: 5,
      mesInicio: '2026-07',
      mesFim: '2026-09',
    });
  });

  it('indefinida → série sem mesFim', () => {
    const s = store();
    s.adicionarLancamentoComRecorrencia({
      data: '2026-07-05', tipo: 'entrada', valorCentavos: 400000, descricao: 'Salário', recorrencia: 'indefinida',
    });
    expect(seriesVivas(s)[0]!.mesFim).toBeNull();
  });
});

describe('editarSerieAPartir', () => {
  it('edita em lugar quando mk === mesInicio', () => {
    const s = store();
    const serie = s.adicionarSerie({
      tipo: 'saida', valorCentavos: 1200, descricao: 'Assinatura', diaDoMes: 5,
      mesInicio: '2026-07', repeticao: { meses: 3 },
    });
    s.editarSerieAPartir(serie.id, '2026-07', { valorCentavos: 1500 });
    expect(seriesVivas(s)).toHaveLength(1);
    expect(s.dados.series[serie.id]).toMatchObject({ valorCentavos: 1500, mesFim: '2026-09' });
  });

  it('faz split quando mk é posterior, preservando o passado (e a carteira)', () => {
    const s = store();
    const serie = s.adicionarSerie({
      tipo: 'saida', valorCentavos: 1200, descricao: 'Assinatura', diaDoMes: 10,
      mesInicio: '2026-07', repeticao: { meses: 3 },
    });
    s.editarSerieAPartir(serie.id, '2026-08', { valorCentavos: 1500 });
    expect(s.dados.series[serie.id]).toMatchObject({ mesFim: '2026-07', valorCentavos: 1200 });
    const nova = Object.values(s.dados.series).find((x) => x.id !== serie.id)!;
    expect(nova).toMatchObject({
      mesInicio: '2026-08', mesFim: '2026-09', valorCentavos: 1500,
      carteiraId: serie.carteiraId, diaDoMes: 10,
    });
  });
});

describe('encerrarSerieAPartir', () => {
  it('exclui no mesInicio; trunca em mês posterior', () => {
    const s = store();
    const a = s.adicionarSerie({ tipo: 'saida', valorCentavos: 1200, descricao: 'x', diaDoMes: 1, mesInicio: '2026-07', repeticao: 'indefinida' });
    s.encerrarSerieAPartir(a.id, '2026-07');
    expect(s.dados.series[a.id]!.deleted).toBe(true);

    const b = s.adicionarSerie({ tipo: 'saida', valorCentavos: 1200, descricao: 'y', diaDoMes: 1, mesInicio: '2026-07', repeticao: 'indefinida' });
    s.encerrarSerieAPartir(b.id, '2026-10');
    expect(s.dados.series[b.id]!.deleted).toBe(false);
    expect(s.dados.series[b.id]!.mesFim).toBe('2026-09');
  });
});

describe('backup: exportar / importar', () => {
  it('exportar é cópia JSON-safe dos dados', () => {
    const s = store();
    s.adicionarLancamento({ data: '2026-07-01', tipo: 'saida', valorCentavos: 25000, descricao: 'mercado' });
    const exp = s.exportar();
    expect(exp).not.toBe(s.dados);
    expect(JSON.parse(JSON.stringify(s.dados))).toEqual(exp);
  });

  it('importar migra JSON antigo (v1) até a versão atual e cria carteira', async () => {
    const v1 = JSON.stringify({
      version: 1,
      config: { ano: 2026, rendaPadraoCentavos: 0, custosFixosPadrao: [] },
      meses: {},
      lancamentos: {
        a: { id: 'a', data: '2026-01-05', tipo: 'gasto', valorCentavos: 3000, descricao: '', updatedAt: 'x', deleted: false },
      },
      sync: { driveFileId: null, lastSyncedHash: null },
    });
    const s = store();
    await s.importar(v1);
    expect(s.dados.version).toBe(6);
    expect(s.dados.lancamentos['a']!.tipo).toBe('saida');
    const carteiraId = Object.keys(s.dados.carteiras)[0]!;
    expect(s.dados.lancamentos['a']!.carteiraId).toBe(carteiraId); // movido pra Corrente
  });

  it('importar rejeita JSON malformado', async () => {
    const s = store();
    await expect(s.importar('{ nao é json')).rejects.toThrow();
  });

  it('importar rejeita dados com forma inválida', async () => {
    const ruim = JSON.stringify({
      version: 5,
      config: { ano: 2026 },
      carteiras: { c1: { id: 'c1', nome: 'Corrente', valorDiarioCentavos: 0, updatedAt: 'x', deleted: false } },
      series: {},
      lancamentos: {
        a: { id: 'a', carteiraId: 'c1', data: '2026-01-05', tipo: 'saida', valorCentavos: -1, descricao: '', updatedAt: 'x', deleted: false },
      },
      sync: { driveFileId: null, lastSyncedHash: null },
    });
    const s = store();
    await expect(s.importar(ruim)).rejects.toThrow(/valorCentavos/);
  });
});
