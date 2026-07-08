import { carregar, pedirPersistencia, salvar } from './data/storage.ts';
import { migrar } from './data/migrate.ts';
import { validarAppData } from './data/validate.ts';
import { hojeISO, mesKeyDeData, toMesKey, type ISODate, type MesKey } from './data/dates.ts';
import {
  novoId,
  type AppData,
  type CustoFixo,
  type Lancamento,
  type TipoLancamento,
} from './data/schema.ts';

// Ponte entre a camada de dados e o Alpine. Mantém o AppData em memória e
// garante escrita local imediata a cada mutação (regra 6: local sempre; o sync
// best-effort com debounce vem depois, quando o Drive entrar).

type Estado = 'carregando' | 'pronto' | 'erro';

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

  // ---- CRUD de lançamentos ----

  adicionarLancamento(input: {
    data: ISODate;
    tipo: TipoLancamento;
    valorCentavos: number;
    descricao: string;
  }): Lancamento {
    const l: Lancamento = {
      id: novoId('lanc'),
      data: input.data,
      tipo: input.tipo,
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

  // ---- planilha: um valor por dia (upsert por data+tipo) ----

  /** Lançamento vivo daquele dia+tipo, se houver. */
  private acharDoDia(data: ISODate, tipo: TipoLancamento): Lancamento | undefined {
    return Object.values(this.dados.lancamentos).find(
      (l) => !l.deleted && l.data === data && l.tipo === tipo,
    );
  }

  /**
   * Define o valor único de um dia (célula da planilha). Mantém no máximo um
   * lançamento vivo por (data, tipo): atualiza o existente, cria se não houver,
   * ou soft-deleta quando `centavos` é null/0.
   */
  setValorDia(data: ISODate, tipo: TipoLancamento, centavos: number | null): void {
    const existente = this.acharDoDia(data, tipo);
    if (centavos === null || centavos <= 0) {
      if (existente) this.removerLancamento(existente.id);
      return;
    }
    if (existente) {
      this.atualizarLancamento(existente.id, { valorCentavos: centavos });
    } else {
      this.adicionarLancamento({ data, tipo, valorCentavos: centavos, descricao: '' });
    }
  }

  // ---- config (padrão): salário + custos fixos ----

  setRenda(centavos: number): void {
    this.dados.config.rendaPadraoCentavos = Math.max(0, Math.round(centavos));
    this.persistir();
  }

  /** Adiciona um custo fixo ao padrão. Retorna o id gerado. */
  addCustoFixo(nome: string, valorCentavos: number): string {
    const fixo: CustoFixo = {
      id: novoId('fx'),
      nome: nome.trim(),
      valorCentavos: Math.max(0, Math.round(valorCentavos)),
    };
    this.dados.config.custosFixosPadrao.push(fixo);
    this.persistir();
    return fixo.id;
  }

  atualizarCustoFixo(id: string, patch: Partial<Omit<CustoFixo, 'id'>>): void {
    const fixo = this.dados.config.custosFixosPadrao.find((f) => f.id === id);
    if (!fixo) return;
    if (patch.nome !== undefined) fixo.nome = patch.nome.trim();
    if (patch.valorCentavos !== undefined) {
      fixo.valorCentavos = Math.max(0, Math.round(patch.valorCentavos));
    }
    this.persistir();
  }

  removerCustoFixo(id: string): void {
    const antes = this.dados.config.custosFixosPadrao.length;
    this.dados.config.custosFixosPadrao = this.dados.config.custosFixosPadrao.filter(
      (f) => f.id !== id,
    );
    if (this.dados.config.custosFixosPadrao.length !== antes) this.persistir();
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
