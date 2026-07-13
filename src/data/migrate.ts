import { mesAnterior, mesSeguinte, type MesKey } from './dates.ts';
import { novoId, SCHEMA_VERSION, type AppData } from './schema.ts';

// Regra 3: migração no load, sempre. Cada passo leva de version N para N+1.
// Quando o schema mudar: bump SCHEMA_VERSION e adiciona um caso aqui.
//
// Passos recebem/retornam `any` de propósito — cada versão histórica tem uma
// forma diferente e não vale a pena tipar formas antigas mortas.
type PassoMigracao = (dados: any) => any;

/** Trunca séries que cobrem `mk` em mesAnterior(mk) e reabre continuação depois de `mk`. */
function truncarEReabrir(ativas: any[], mk: MesKey): any[] {
  const resultado: any[] = [];
  for (const s of ativas) {
    const cobre = s.mesInicio <= mk && (s.mesFim === null || s.mesFim >= mk);
    if (!cobre) {
      resultado.push(s);
      continue;
    }
    const fimOriginal = s.mesFim;
    const novoFim = mesAnterior(mk);
    if (novoFim >= s.mesInicio) {
      resultado.push({ ...s, mesFim: novoFim, id: novoId('serie') });
    }
    const inicioContinuacao = mesSeguinte(mk);
    if (fimOriginal === null || fimOriginal >= inicioContinuacao) {
      resultado.push({ ...s, mesInicio: inicioContinuacao, mesFim: fimOriginal, id: novoId('serie') });
    }
  }
  return resultado;
}

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

  // v2 → v3: remove config de renda/custos fixos "pra sempre" (e o mecanismo
  // de override por mês, nunca exposto em nenhuma tela). Salário vira uma
  // série recorrente de entrada indefinida; cada custo fixo vira uma série
  // recorrente de saída indefinida. Overrides de mês existentes (na prática
  // sempre vazios, mas tratados por completude — regra 7: não perder dados)
  // truncam a série padrão correspondente e viram uma série de um mês só.
  2: (d: any) => {
    const now = new Date().toISOString();
    // Deixa estourar se config estiver ausente/corrompido — mesmo espírito
    // do passo anterior: migração não "conserta" dados fundamentalmente
    // quebrados, só transforma forma válida antiga em forma válida nova.
    const anoBase: number = d.config.ano;
    const mesInicioPadrao: MesKey = `${String(anoBase).padStart(4, '0')}-01`;

    const criarSerie = (tipo: 'entrada' | 'saida', descricao: string, valorCentavos: number) => ({
      id: novoId('serie'),
      tipo,
      valorCentavos,
      descricao,
      mesInicio: mesInicioPadrao,
      mesFim: null as MesKey | null,
      updatedAt: now,
      deleted: false,
    });

    let entradaAtivas: any[] = [];
    const rendaPadrao: number = d.config.rendaPadraoCentavos ?? 0;
    if (rendaPadrao > 0) entradaAtivas = [criarSerie('entrada', 'Salário', rendaPadrao)];

    let saidaAtivas: any[] = (d.config.custosFixosPadrao ?? []).map((f: any) =>
      criarSerie('saida', f.nome, f.valorCentavos),
    );

    const meses = d.meses ?? {};
    for (const mk of Object.keys(meses).sort()) {
      const override = meses[mk];
      if (!override) continue;

      if (override.rendaOverrideCentavos !== null && override.rendaOverrideCentavos !== undefined) {
        entradaAtivas = truncarEReabrir(entradaAtivas, mk);
        if (override.rendaOverrideCentavos > 0) {
          entradaAtivas.push({
            ...criarSerie('entrada', 'Salário', override.rendaOverrideCentavos),
            mesInicio: mk,
            mesFim: mk,
          });
        }
      }

      if (override.custosFixosOverride !== null && override.custosFixosOverride !== undefined) {
        saidaAtivas = truncarEReabrir(saidaAtivas, mk);
        for (const f of override.custosFixosOverride) {
          saidaAtivas.push({
            ...criarSerie('saida', f.nome, f.valorCentavos),
            mesInicio: mk,
            mesFim: mk,
          });
        }
      }
    }

    const series = Object.fromEntries(
      [...entradaAtivas, ...saidaAtivas].map((s) => [s.id, s]),
    );

    return {
      version: 3,
      config: { ano: anoBase },
      series,
      lancamentos: d.lancamentos ?? {},
      sync: d.sync ?? { driveFileId: null, lastSyncedHash: null },
    };
  },

  // v3 → v4: saída avulsa ganha `categoria`. Default 'gasto' pra todo lançamento
  // existente (preserva o comportamento atual: saída avulsa = débito imediato).
  // O usuário re-marca como 'conta' o que for conta do mês.
  3: (d: any) => ({
    ...d,
    version: 4,
    lancamentos: Object.fromEntries(
      Object.entries(d.lancamentos ?? {}).map(([id, l]: [string, any]) => [
        id,
        { ...l, categoria: l.categoria ?? 'gasto' },
      ]),
    ),
  }),

  // v4 → v5: múltiplas carteiras. Cria uma carteira "Corrente" (valor diário 0,
  // o usuário define depois), move todos os lançamentos e séries pra ela, remove
  // `categoria` (sai o modelo conta/gasto) e dá `diaDoMes: 1` às séries (viram
  // lançamentos recorrentes datados). As séries de salário/contas viram
  // lançamentos recorrentes normais da carteira — nada é perdido.
  4: (d: any) => {
    const now = new Date().toISOString();
    const carteiraId = novoId('cart');
    const corrente = {
      id: carteiraId,
      nome: 'Corrente',
      valorDiarioCentavos: 0,
      updatedAt: now,
      deleted: false,
    };
    const lancamentos = Object.fromEntries(
      Object.entries(d.lancamentos ?? {}).map(([id, l]: [string, any]) => {
        const { categoria: _categoria, ...resto } = l;
        return [id, { ...resto, carteiraId }];
      }),
    );
    const series = Object.fromEntries(
      Object.entries(d.series ?? {}).map(([id, s]: [string, any]) => [
        id,
        { ...s, carteiraId, diaDoMes: s.diaDoMes ?? 1 },
      ]),
    );
    return {
      version: 5,
      config: d.config ?? { ano: new Date().getFullYear() },
      carteiras: { [carteiraId]: corrente },
      series,
      lancamentos,
      sync: d.sync ?? { driveFileId: null, lastSyncedHash: null },
    };
  },
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
