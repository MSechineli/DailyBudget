import { carregar, pedirPersistencia, salvar } from './data/storage.ts';
import { migrar } from './data/migrate.ts';
import { validarAppData } from './data/validate.ts';
import {
  adicionarMeses,
  hojeISO,
  mesAnterior,
  mesKeyDeData,
  toMesKey,
  type ISODate,
  type MesKey,
} from './data/dates.ts';
import {
  novoId,
  type AppData,
  type CategoriaLancamento,
  type Lancamento,
  type SerieRecorrente,
  type TipoLancamento,
} from './data/schema.ts';

// Ponte entre a camada de dados e o Alpine. Mantém o AppData em memória e
// garante escrita local imediata a cada mutação (regra 6: local sempre; o sync
// best-effort com debounce vem depois, quando o Drive entrar).

type Estado = 'carregando' | 'pronto' | 'erro';

/** Recorrência escolhida na modal de novo lançamento. */
export type Recorrencia = 'nenhuma' | 'indefinida' | { meses: number };

export class Store {
  dados!: AppData;
  estado: Estado = 'carregando';
  origem: 'atual' | 'ultimaBoa' | 'novo' = 'novo';
  mesAtual: MesKey = toMesKey(new Date().getFullYear(), new Date().getMonth() + 1);

  // Coalescing da gravação local: se já há um save em andamento, marca pra
  // rodar de novo ao terminar (evita writes concorrentes do mesmo objeto).
  private salvando: Promise<void> | null = null;
  private salvarDeNovo = false;

  async init(): Promise<void> {
    try {
      await pedirPersistencia();
      const r = await carregar(new Date().getFullYear());
      this.dados = r.dados;
      this.origem = r.origem;
      this.estado = 'pronto';
      // Regra 6: garante a última gravação antes de ocultar/fechar a página.
      // pagehide é o evento mais confiável em mobile pra fechamento/reload.
      const flush = () => void this.flush();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
      });
      window.addEventListener('pagehide', flush);
    } catch (e) {
      console.error('[store] falha ao iniciar:', e);
      this.estado = 'erro';
    }
  }

  // ---- persistência ----
  // Regra 6: escrita LOCAL é sempre garantida e imediata — nunca esperar rede.
  // (O debounce vale só pro sync do Drive, que será adicionado depois.)

  /** Persiste local imediatamente, coalescendo chamadas concorrentes. */
  private persistir(): void {
    if (this.salvando) {
      this.salvarDeNovo = true;
      return;
    }
    this.salvando = salvar(this.dados)
      .catch((e) => console.error('[store] falha ao salvar local:', e))
      .finally(() => {
        this.salvando = null;
        if (this.salvarDeNovo) {
          this.salvarDeNovo = false;
          this.persistir();
        }
        // TODO(sync): marcar dirty e agendar upload best-effort pro Drive (com debounce).
      });
  }

  /** Garante que o estado atual está no disco. Usado no pagehide/visibilitychange. */
  async flush(): Promise<void> {
    while (this.salvando) await this.salvando;
    try {
      await salvar(this.dados);
    } catch (e) {
      console.error('[store] falha ao salvar local:', e);
    }
  }

  // ---- CRUD de lançamentos avulsos (day-exact) ----

  adicionarLancamento(input: {
    data: ISODate;
    tipo: TipoLancamento;
    valorCentavos: number;
    descricao: string;
    categoria?: CategoriaLancamento;
  }): Lancamento {
    const l: Lancamento = {
      id: novoId('lanc'),
      data: input.data,
      tipo: input.tipo,
      // Categoria só importa em saída; entrada grava 'gasto' (ignorado no cálculo).
      categoria: input.tipo === 'saida' ? (input.categoria ?? 'gasto') : 'gasto',
      valorCentavos: input.valorCentavos,
      descricao: input.descricao.trim(),
      updatedAt: new Date().toISOString(),
      deleted: false,
    };
    this.dados.lancamentos[l.id] = l;
    this.persistir();
    return l;
  }

  atualizarLancamento(id: string, patch: Partial<Omit<Lancamento, 'id'>>): void {
    const atual = this.dados.lancamentos[id];
    if (!atual) return;
    this.dados.lancamentos[id] = {
      ...atual,
      ...patch,
      id,
      updatedAt: new Date().toISOString(),
    };
    this.persistir();
  }

  /** Soft delete (regra do schema: mantém o item com deleted=true). */
  removerLancamento(id: string): void {
    const atual = this.dados.lancamentos[id];
    if (!atual) return;
    atual.deleted = true;
    atual.updatedAt = new Date().toISOString();
    this.persistir();
  }

  // ---- séries recorrentes (salário, gastos fixos, qualquer lançamento repetido) ----

  adicionarSerie(input: {
    tipo: TipoLancamento;
    valorCentavos: number;
    descricao: string;
    mesInicio: MesKey;
    repeticao: 'indefinida' | { meses: number };
  }): SerieRecorrente {
    const mesFim =
      input.repeticao === 'indefinida'
        ? null
        : adicionarMeses(input.mesInicio, input.repeticao.meses - 1);
    const s: SerieRecorrente = {
      id: novoId('serie'),
      tipo: input.tipo,
      valorCentavos: input.valorCentavos,
      descricao: input.descricao.trim(),
      mesInicio: input.mesInicio,
      mesFim,
      updatedAt: new Date().toISOString(),
      deleted: false,
    };
    this.dados.series[s.id] = s;
    this.persistir();
    return s;
  }

  /**
   * Ponto de entrada único da modal de novo lançamento: sem recorrência vira
   * um lançamento avulso (day-exact); com recorrência vira uma série
   * recorrente a partir do mês da data informada.
   */
  adicionarLancamentoComRecorrencia(input: {
    data: ISODate;
    tipo: TipoLancamento;
    valorCentavos: number;
    descricao: string;
    categoria?: CategoriaLancamento;
    recorrencia: Recorrencia;
  }): void {
    if (input.recorrencia === 'nenhuma') {
      // Avulso: carrega a categoria (conta/gasto) escolhida na modal.
      this.adicionarLancamento(input);
      return;
    }
    // Saída recorrente vira série (conta fixa implícita) — categoria não se aplica.
    this.adicionarSerie({
      tipo: input.tipo,
      valorCentavos: input.valorCentavos,
      descricao: input.descricao,
      mesInicio: mesKeyDeData(input.data),
      repeticao: input.recorrencia,
    });
  }

  /**
   * Edita uma série "a partir do mês `mk`" sem tocar em meses anteriores.
   * Se `mk` é o mês em que a série começou, edita em lugar (nada passou
   * ainda). Senão, faz um split: trunca a série antiga em mesAnterior(mk) e
   * cria uma nova série com o patch cobrindo de `mk` até o mesFim original.
   */
  editarSerieAPartir(
    id: string,
    mk: MesKey,
    patch: { valorCentavos?: number; descricao?: string },
  ): void {
    const atual = this.dados.series[id];
    if (!atual || atual.deleted) return;

    if (mk === atual.mesInicio) {
      this.dados.series[id] = {
        ...atual,
        ...patch,
        descricao: patch.descricao !== undefined ? patch.descricao.trim() : atual.descricao,
        id,
        updatedAt: new Date().toISOString(),
      };
      this.persistir();
      return;
    }

    const now = new Date().toISOString();
    const fimOriginal = atual.mesFim;
    atual.mesFim = mesAnterior(mk);
    atual.updatedAt = now;

    const nova: SerieRecorrente = {
      ...atual,
      id: novoId('serie'),
      valorCentavos: patch.valorCentavos ?? atual.valorCentavos,
      descricao: patch.descricao !== undefined ? patch.descricao.trim() : atual.descricao,
      mesInicio: mk,
      mesFim: fimOriginal,
      updatedAt: now,
      deleted: false,
    };
    this.dados.series[nova.id] = nova;
    this.persistir();
  }

  /**
   * Encerra uma série "a partir do mês `mk`". Se `mk` é o mês em que a série
   * começou, é uma exclusão completa (nunca teve mês ativo). Senão, trunca
   * mesFim em mesAnterior(mk), preservando o histórico.
   */
  encerrarSerieAPartir(id: string, mk: MesKey): void {
    const atual = this.dados.series[id];
    if (!atual || atual.deleted) return;
    if (mk === atual.mesInicio) {
      atual.deleted = true;
    } else {
      atual.mesFim = mesAnterior(mk);
    }
    atual.updatedAt = new Date().toISOString();
    this.persistir();
  }

  // ---- backup: export / import ----

  /** Snapshot plano (JSON-safe) dos dados atuais, para exportar. */
  exportar(): AppData {
    return JSON.parse(JSON.stringify(this.dados));
  }

  /**
   * Substitui todos os dados por um JSON importado. Passa pela mesma migração
   * e validação do load (regras 3 e 7): sobe a versão e recusa forma inválida.
   * Lança se o JSON for inválido; grava local na hora se der certo.
   */
  async importar(texto: string): Promise<void> {
    const cru = JSON.parse(texto); // SyntaxError se não for JSON
    const dados = migrar(cru); // sobe até a versão atual
    validarAppData(dados); // garante a forma
    this.dados = dados;
    await this.flush(); // persiste imediatamente
  }

  // ---- navegação de mês ----

  irParaMes(mk: MesKey): void {
    this.mesAtual = mk;
  }

  mesDeHoje(): MesKey {
    return mesKeyDeData(hojeISO());
  }
}
