import { describe, expect, it } from 'vitest';
import { Store } from './store.ts';
import { criarDadosVazios, type Lancamento, type SerieRecorrente } from './data/schema.ts';

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

function seriesVivas(s: Store): SerieRecorrente[] {
  return Object.values(s.dados.series).filter((x) => !x.deleted);
}

describe('adicionarLancamento / atualizarLancamento / removerLancamento (avulsos)', () => {
  it('cria um lançamento avulso', () => {
    const s = store();
    s.adicionarLancamento({ data: '2026-07-01', tipo: 'saida', valorCentavos: 25000, descricao: 'mercado' });
    expect(vivos(s)).toHaveLength(1);
    expect(vivos(s)[0]).toMatchObject({ data: '2026-07-01', tipo: 'saida', valorCentavos: 25000 });
  });

  it('permite múltiplos avulsos no mesmo dia+tipo', () => {
    const s = store();
    s.adicionarLancamento({ data: '2026-07-01', tipo: 'saida', valorCentavos: 100, descricao: 'mercado' });
    s.adicionarLancamento({ data: '2026-07-01', tipo: 'saida', valorCentavos: 200, descricao: 'uber' });
    expect(vivos(s)).toHaveLength(2);
  });

  it('atualizarLancamento edita campos e soft-delete remove', () => {
    const s = store();
    const l = s.adicionarLancamento({ data: '2026-07-01', tipo: 'saida', valorCentavos: 100, descricao: 'x' });
    s.atualizarLancamento(l.id, { valorCentavos: 200 });
    expect(s.dados.lancamentos[l.id]!.valorCentavos).toBe(200);
    s.removerLancamento(l.id);
    expect(vivos(s)).toHaveLength(0);
    expect(Object.keys(s.dados.lancamentos)).toHaveLength(1); // soft delete, continua no map
  });
});

describe('adicionarSerie', () => {
  it('repeticao indefinida gera mesFim null', () => {
    const s = store();
    const serie = s.adicionarSerie({
      tipo: 'entrada', valorCentavos: 400000, descricao: 'Salário',
      mesInicio: '2026-07', repeticao: 'indefinida',
    });
    expect(serie.mesFim).toBeNull();
    expect(seriesVivas(s)).toHaveLength(1);
  });

  it('repeticao de N meses calcula mesFim inclusive', () => {
    const s = store();
    const serie = s.adicionarSerie({
      tipo: 'saida', valorCentavos: 5000, descricao: 'Assinatura',
      mesInicio: '2026-07', repeticao: { meses: 3 },
    });
    expect(serie.mesFim).toBe('2026-09'); // jul, ago, set
  });

  it('N meses vira o ano corretamente', () => {
    const s = store();
    const serie = s.adicionarSerie({
      tipo: 'saida', valorCentavos: 5000, descricao: 'x',
      mesInicio: '2026-11', repeticao: { meses: 3 },
    });
    expect(serie.mesFim).toBe('2027-01');
  });
});

describe('adicionarLancamentoComRecorrencia', () => {
  it('recorrencia nenhuma cria um avulso, não uma série', () => {
    const s = store();
    s.adicionarLancamentoComRecorrencia({
      data: '2026-07-05', tipo: 'saida', valorCentavos: 3000, descricao: 'mercado', recorrencia: 'nenhuma',
    });
    expect(vivos(s)).toHaveLength(1);
    expect(seriesVivas(s)).toHaveLength(0);
  });

  it('grava a categoria escolhida na saída avulsa (conta vs gasto)', () => {
    const s = store();
    s.adicionarLancamentoComRecorrencia({
      data: '2026-07-05', tipo: 'saida', categoria: 'conta', valorCentavos: 120000, descricao: 'cartão',
      recorrencia: 'nenhuma',
    });
    expect(vivos(s)[0]!.categoria).toBe('conta');
  });

  it('saída avulsa sem categoria explícita cai em "gasto"; entrada sempre "gasto"', () => {
    const s = store();
    s.adicionarLancamentoComRecorrencia({
      data: '2026-07-05', tipo: 'saida', valorCentavos: 3000, descricao: 'mercado', recorrencia: 'nenhuma',
    });
    s.adicionarLancamentoComRecorrencia({
      data: '2026-07-06', tipo: 'entrada', categoria: 'conta', valorCentavos: 5000, descricao: 'x',
      recorrencia: 'nenhuma',
    });
    const [saida, entrada] = vivos(s);
    expect(saida!.categoria).toBe('gasto');
    expect(entrada!.categoria).toBe('gasto'); // entrada ignora categoria
  });

  it('recorrencia N meses cria uma série a partir do mês da data', () => {
    const s = store();
    s.adicionarLancamentoComRecorrencia({
      data: '2026-07-05', tipo: 'saida', valorCentavos: 1200, descricao: 'aluguel',
      recorrencia: { meses: 3 },
    });
    expect(vivos(s)).toHaveLength(0);
    const series = seriesVivas(s);
    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({ mesInicio: '2026-07', mesFim: '2026-09', valorCentavos: 1200 });
  });

  it('recorrencia indefinida cria uma série sem mesFim', () => {
    const s = store();
    s.adicionarLancamentoComRecorrencia({
      data: '2026-07-05', tipo: 'entrada', valorCentavos: 400000, descricao: 'Salário',
      recorrencia: 'indefinida',
    });
    expect(seriesVivas(s)[0]!.mesFim).toBeNull();
  });
});

describe('editarSerieAPartir', () => {
  it('edita em lugar quando o mês é o próprio mesInicio (nada passou ainda)', () => {
    const s = store();
    const serie = s.adicionarSerie({
      tipo: 'saida', valorCentavos: 1200, descricao: 'Assinatura',
      mesInicio: '2026-07', repeticao: { meses: 3 },
    });
    s.editarSerieAPartir(serie.id, '2026-07', { valorCentavos: 1500 });
    expect(seriesVivas(s)).toHaveLength(1);
    expect(s.dados.series[serie.id]).toMatchObject({ valorCentavos: 1500, mesInicio: '2026-07', mesFim: '2026-09' });
  });

  it('faz split quando o mês é posterior ao mesInicio, sem afetar o passado', () => {
    const s = store();
    const serie = s.adicionarSerie({
      tipo: 'saida', valorCentavos: 1200, descricao: 'Assinatura',
      mesInicio: '2026-07', repeticao: { meses: 3 }, // jul, ago, set
    });
    s.editarSerieAPartir(serie.id, '2026-08', { valorCentavos: 1500 });

    const antiga = s.dados.series[serie.id]!;
    expect(antiga.mesInicio).toBe('2026-07');
    expect(antiga.mesFim).toBe('2026-07'); // truncada em mesAnterior(2026-08)
    expect(antiga.valorCentavos).toBe(1200); // passado não muda

    const novas = Object.values(s.dados.series).filter((x) => x.id !== serie.id);
    expect(novas).toHaveLength(1);
    expect(novas[0]).toMatchObject({ mesInicio: '2026-08', mesFim: '2026-09', valorCentavos: 1500 });
  });

  it('série indefinida: split preserva mesFim null na continuação', () => {
    const s = store();
    const serie = s.adicionarSerie({
      tipo: 'entrada', valorCentavos: 400000, descricao: 'Salário',
      mesInicio: '2026-01', repeticao: 'indefinida',
    });
    s.editarSerieAPartir(serie.id, '2026-07', { valorCentavos: 450000 });
    const nova = Object.values(s.dados.series).find((x) => x.id !== serie.id)!;
    expect(nova).toMatchObject({ mesInicio: '2026-07', mesFim: null, valorCentavos: 450000 });
  });
});

describe('encerrarSerieAPartir', () => {
  it('exclui quando o mês é o mesInicio (nunca teve mês ativo)', () => {
    const s = store();
    const serie = s.adicionarSerie({
      tipo: 'saida', valorCentavos: 1200, descricao: 'x',
      mesInicio: '2026-07', repeticao: 'indefinida',
    });
    s.encerrarSerieAPartir(serie.id, '2026-07');
    expect(s.dados.series[serie.id]!.deleted).toBe(true);
  });

  it('trunca mesFim quando o mês é posterior ao mesInicio, preservando o histórico', () => {
    const s = store();
    const serie = s.adicionarSerie({
      tipo: 'saida', valorCentavos: 1200, descricao: 'x',
      mesInicio: '2026-07', repeticao: 'indefinida',
    });
    s.encerrarSerieAPartir(serie.id, '2026-10');
    expect(s.dados.series[serie.id]!.deleted).toBe(false);
    expect(s.dados.series[serie.id]!.mesFim).toBe('2026-09');
  });
});

describe('backup: exportar / importar', () => {
  it('exportar devolve um objeto simples (sem proxy) igual aos dados', () => {
    const s = store();
    s.adicionarSerie({ tipo: 'entrada', valorCentavos: 400000, descricao: 'Salário', mesInicio: '2026-07', repeticao: 'indefinida' });
    s.adicionarLancamento({ data: '2026-07-01', tipo: 'saida', valorCentavos: 25000, descricao: 'mercado' });
    const exp = s.exportar();
    expect(exp).not.toBe(s.dados); // é cópia
    expect(JSON.parse(JSON.stringify(s.dados))).toEqual(exp);
  });

  it('importar substitui os dados a partir de um JSON válido', async () => {
    const origem = store();
    origem.adicionarSerie({ tipo: 'entrada', valorCentavos: 300000, descricao: 'Salário', mesInicio: '2026-07', repeticao: 'indefinida' });
    origem.adicionarSerie({ tipo: 'saida', valorCentavos: 120000, descricao: 'Aluguel', mesInicio: '2026-07', repeticao: 'indefinida' });
    origem.adicionarLancamento({ data: '2026-07-03', tipo: 'entrada', valorCentavos: 15000, descricao: 'reembolso' });
    const json = JSON.stringify(origem.exportar());

    const destino = store();
    await destino.importar(json);
    expect(Object.values(destino.dados.series)).toHaveLength(2);
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
    expect(s.dados.version).toBe(4);
    expect(s.dados.lancamentos['a']!.tipo).toBe('saida');
    expect(s.dados.lancamentos['a']!.categoria).toBe('gasto'); // v3→v4 default
  });

  it('importar rejeita JSON malformado', async () => {
    const s = store();
    await expect(s.importar('{ nao é json')).rejects.toThrow();
  });

  it('importar rejeita dados com forma inválida', async () => {
    const s = store();
    // valorCentavos negativo não passa na validação
    const ruim = JSON.stringify({
      version: 3,
      config: { ano: 2026 },
      series: {},
      lancamentos: {
        a: { id: 'a', data: '2026-01-05', tipo: 'saida', valorCentavos: -1, descricao: '', updatedAt: 'x', deleted: false },
      },
      sync: { driveFileId: null, lastSyncedHash: null },
    });
    await expect(s.importar(ruim)).rejects.toThrow(/valorCentavos/);
  });
});
