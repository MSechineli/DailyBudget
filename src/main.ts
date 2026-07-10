import Alpine from 'alpinejs';
import { Store, type Recorrencia } from './store.ts';
import {
  agregadoMesDe,
  calcularMesDe,
  contasDoMes,
  custoDiarioMedio,
  itensDoMes,
  rendaMes,
  resumoMesDe,
  saldoInicialMes,
  type ItemMes,
} from './data/derive.ts';
import type { DiaCalculado } from './data/domain.ts';
import { formatBRL, parseBRLToCentavos } from './data/money.ts';
import { hojeISO, mesKeyDeData, parseMesKey, toMesKey } from './data/dates.ts';
import type { TipoLancamento } from './data/schema.ts';
import './style.css';

type ModalModo = 'novo' | 'editarSerie' | 'editarLancamento';

interface ModalForm {
  tipo: TipoLancamento;
  categoria: 'conta' | 'gasto'; // só usado em saída avulsa
  data: string; // 'YYYY-MM-DD'
  valor: string; // texto BRL, ex.: "19,90"
  descricao: string;
  recorrenciaTipo: 'nenhuma' | 'nMeses' | 'indefinida';
  recorrenciaMeses: string;
}

// Componente principal do Alpine: a planilha diária. Uma linha por dia do
// mês, com os totais de Saída/Entrada avulsos (read-only) e o saldo
// acumulando. Lançamentos (avulsos e recorrentes) são criados/editados pela
// modal; a lista "Lançamentos do mês" mostra tudo o que compõe o mês atual.
//
// IMPORTANTE: todo acesso ao store é via `this.store` (o proxy reativo do
// Alpine), nunca por variável de closure — senão o re-render não dispara.
function app() {
  return {
    store: new Store(),
    listaAberta: false,
    hoje: hojeISO(),

    // ---- modal de lançamento ----
    modalAberto: false,
    modalModo: 'novo' as ModalModo,
    modalAlvoId: null as string | null,
    modalForm: {
      tipo: 'saida',
      categoria: 'gasto',
      data: hojeISO(),
      valor: '',
      descricao: '',
      recorrenciaTipo: 'nenhuma',
      recorrenciaMeses: '3',
    } as ModalForm,

    async init() {
      await this.store.init();
    },

    // ---- helpers de exibição ----
    fmt: formatBRL,

    get pronto(): boolean {
      return this.store.estado === 'pronto';
    },

    get mesLabel(): string {
      const { ano, mes } = parseMesKey(this.store.mesAtual);
      const nomes = [
        'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
        'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
      ];
      return `${nomes[mes - 1]} / ${ano}`;
    },

    // ---- painel resumo ----
    get rendaFmt(): string {
      return this.pronto ? formatBRL(rendaMes(this.store.dados, this.store.mesAtual)) : '—';
    },
    /** Total das contas do mês (fixas + variáveis). */
    get contasFmt(): string {
      return this.pronto ? formatBRL(contasDoMes(this.store.dados, this.store.mesAtual)) : '—';
    },
    /** Sobra livre = renda − contas. É o bolo que vira budget diário. */
    get sobraLivreFmt(): string {
      if (!this.pronto) return '—';
      return formatBRL(resumoMesDe(this.store.dados, this.store.mesAtual).sobraCentavos);
    },
    get sobraLivreVermelha(): boolean {
      if (!this.pronto) return false;
      return resumoMesDe(this.store.dados, this.store.mesAtual).sobraCentavos < 0;
    },
    get custoDiarioFmt(): string {
      if (!this.pronto) return '—';
      return formatBRL(Math.round(custoDiarioMedio(this.store.dados, this.store.mesAtual)));
    },
    get saldoFinalFmt(): string {
      if (!this.pronto) return '—';
      return formatBRL(agregadoMesDe(this.store.dados, this.store.mesAtual).saldoFinalCentavos);
    },
    /** Saldo herdado do(s) mês(es) anterior(es) — rollover contínuo. */
    get saldoInicialFmt(): string {
      if (!this.pronto) return '—';
      return formatBRL(saldoInicialMes(this.store.dados, this.store.mesAtual));
    },

    // ---- quanto posso gastar (hoje / dia / semana) ----
    /** O DiaCalculado de hoje, se o mês exibido é o mês de hoje; senão null. */
    get diaDeHoje(): DiaCalculado | null {
      return this.dias.find((d) => d.data === this.hoje) ?? null;
    },
    /** Saldo disponível hoje (o quanto dá pra gastar e ficar em zero). '—' fora do mês atual. */
    get disponivelHojeFmt(): string {
      const hoje = this.diaDeHoje;
      return hoje ? formatBRL(hoje.saldoCentavos) : '—';
    },
    get disponivelHojeVermelho(): boolean {
      const hoje = this.diaDeHoje;
      return hoje ? hoje.saldoCentavos < 0 : false;
    },
    /** Ritmo semanal = custo diário médio × 7. */
    get porSemanaFmt(): string {
      if (!this.pronto) return '—';
      return formatBRL(Math.round(custoDiarioMedio(this.store.dados, this.store.mesAtual) * 7));
    },

    // ---- lançamentos do mês (avulsos + séries recorrentes) ----
    get itensMes(): ItemMes[] {
      return this.pronto ? itensDoMes(this.store.dados, this.store.mesAtual) : [];
    },
    /** Rótulo de até quando a série vale. */
    serieFimLabel(item: ItemMes): string {
      if (item.origem !== 'serie') return '';
      return item.serie.mesFim === null ? 'sem fim' : `até ${item.serie.mesFim}`;
    },
    /** Texto do botão de encerrar: exclui se a série ainda não teve mês ativo antes do atual. */
    encerrarLabel(item: ItemMes): string {
      if (item.origem !== 'serie') return '';
      return item.serie.mesInicio === this.store.mesAtual ? 'Excluir' : 'Encerrar daqui';
    },
    abrirModalEditarSerie(item: ItemMes) {
      if (item.origem !== 'serie') return;
      this.modalModo = 'editarSerie';
      this.modalAlvoId = item.id;
      this.modalForm = {
        tipo: item.tipo,
        categoria: 'gasto',
        data: this.store.mesAtual + '-01',
        valor: this.plain(item.valorCentavos),
        descricao: item.descricao,
        recorrenciaTipo: 'nenhuma',
        recorrenciaMeses: '3',
      };
      this.modalAberto = true;
    },
    abrirModalEditarLancamento(item: ItemMes) {
      if (item.origem !== 'avulso') return;
      this.modalModo = 'editarLancamento';
      this.modalAlvoId = item.id;
      this.modalForm = {
        tipo: item.tipo,
        categoria: item.categoria,
        data: item.data,
        valor: this.plain(item.valorCentavos),
        descricao: item.descricao,
        recorrenciaTipo: 'nenhuma',
        recorrenciaMeses: '3',
      };
      this.modalAberto = true;
    },
    encerrarSerie(item: ItemMes) {
      if (item.origem !== 'serie') return;
      if (!confirm(`${this.encerrarLabel(item)} "${item.descricao}"?`)) return;
      this.store.encerrarSerieAPartir(item.id, this.store.mesAtual);
    },
    removerAvulso(item: ItemMes) {
      if (item.origem !== 'avulso') return;
      if (!confirm(`Excluir "${item.descricao || (item.tipo === 'saida' ? 'saída' : 'entrada')}"?`)) return;
      this.store.removerLancamento(item.id);
    },

    // ---- modal: abrir em branco / salvar / fechar ----
    /** Data padrão pro form novo: hoje se estiver no mês atual, senão dia 1 do mês. */
    dataPadraoNoMes(): string {
      return mesKeyDeData(this.hoje) === this.store.mesAtual ? this.hoje : `${this.store.mesAtual}-01`;
    },
    abrirModalNovo(data?: string, tipo?: TipoLancamento) {
      this.modalModo = 'novo';
      this.modalAlvoId = null;
      this.modalForm = {
        tipo: tipo ?? 'saida',
        categoria: 'gasto',
        data: data ?? this.dataPadraoNoMes(),
        valor: '',
        descricao: '',
        recorrenciaTipo: 'nenhuma',
        recorrenciaMeses: '3',
      };
      this.modalAberto = true;
    },
    fecharModal() {
      this.modalAberto = false;
      this.modalAlvoId = null;
    },
    salvarModal() {
      const valorCentavos = parseBRLToCentavos(this.modalForm.valor);
      if (valorCentavos === null || valorCentavos <= 0) return;

      if (this.modalModo === 'novo') {
        const recorrencia: Recorrencia =
          this.modalForm.recorrenciaTipo === 'nenhuma'
            ? 'nenhuma'
            : this.modalForm.recorrenciaTipo === 'indefinida'
              ? 'indefinida'
              : { meses: Math.max(1, Math.round(Number(this.modalForm.recorrenciaMeses) || 1)) };
        this.store.adicionarLancamentoComRecorrencia({
          data: this.modalForm.data,
          tipo: this.modalForm.tipo,
          categoria: this.modalForm.categoria,
          valorCentavos,
          descricao: this.modalForm.descricao,
          recorrencia,
        });
      } else if (this.modalModo === 'editarSerie' && this.modalAlvoId) {
        this.store.editarSerieAPartir(this.modalAlvoId, this.store.mesAtual, {
          valorCentavos,
          descricao: this.modalForm.descricao,
        });
      } else if (this.modalModo === 'editarLancamento' && this.modalAlvoId) {
        this.store.atualizarLancamento(this.modalAlvoId, {
          tipo: this.modalForm.tipo,
          categoria: this.modalForm.tipo === 'saida' ? this.modalForm.categoria : 'gasto',
          data: this.modalForm.data,
          valorCentavos,
          descricao: this.modalForm.descricao,
        });
      }
      this.fecharModal();
    },

    /** Valor pra exibição em input (reais, sem "R$"); vazio quando 0. */
    plain(centavos: number): string {
      return centavos ? formatBRL(centavos).replace('R$', '').trim() : '';
    },

    // ---- backup ----
    mensagemBackup: '' as string,

    /** Baixa um .json com todos os dados. */
    exportar() {
      const json = JSON.stringify(this.store.exportar(), null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gastos-${hojeISO()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.mensagemBackup = 'Backup exportado ✓';
    },

    /** Importa um .json escolhido pelo usuário (migra + valida antes de aplicar). */
    async importar(e: Event) {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      try {
        await this.store.importar(await file.text());
        this.mensagemBackup = 'Dados importados ✓';
      } catch (err) {
        this.mensagemBackup = `Falha ao importar: ${err instanceof Error ? err.message : 'arquivo inválido'}`;
      } finally {
        input.value = ''; // permite reimportar o mesmo arquivo
      }
    },

    // ---- planilha ----
    get dias(): DiaCalculado[] {
      return this.pronto ? calcularMesDe(this.store.dados, this.store.mesAtual) : [];
    },

    /**
     * Geometria do gráfico de saldo do mês (SVG inline, sem lib). Mapeia o
     * saldo de cada dia num viewBox fixo; verde acima do zero, vermelho abaixo
     * (via gradiente com corte na linha do zero). Marca o dia de hoje.
     */
    get grafico(): {
      w: number;
      h: number;
      linha: string;
      area: string;
      zeroY: number;
      zeroFrac: number;
      hojeX: number | null;
    } | null {
      const dias = this.dias;
      if (dias.length < 2) return null;
      const w = 300;
      const h = 90;
      const pad = 6;
      const saldos = dias.map((d) => d.saldoCentavos);
      const min = Math.min(0, ...saldos);
      const max = Math.max(0, ...saldos);
      const span = max - min || 1; // evita divisão por zero
      const n = dias.length;
      const x = (i: number) => pad + (i / (n - 1)) * (w - 2 * pad);
      const y = (v: number) => pad + (1 - (v - min) / span) * (h - 2 * pad);
      const pts = saldos.map((v, i) => [x(i), y(v)] as const);
      const linha = pts
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
        .join(' ');
      const zeroY = y(0);
      const area =
        `M${x(0).toFixed(1)},${zeroY.toFixed(1)} ` +
        pts.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') +
        ` L${x(n - 1).toFixed(1)},${zeroY.toFixed(1)} Z`;
      const hojeIdx = dias.findIndex((d) => d.data === this.hoje);
      return {
        w,
        h,
        linha,
        area,
        zeroY,
        zeroFrac: zeroY / h,
        hojeX: hojeIdx >= 0 ? x(hojeIdx) : null,
      };
    },
    ehHoje(data: string): boolean {
      return data === this.hoje;
    },
    /** dd/mm de uma data ISO. */
    diaMes(data: string): string {
      return `${data.slice(8, 10)}/${data.slice(5, 7)}`;
    },
    /** Total avulso (day-exact) da célula, só exibição. */
    celulaFmt(dia: DiaCalculado, tipo: TipoLancamento): string {
      const c = tipo === 'saida' ? dia.saidasCentavos : dia.entradasCentavos;
      return c ? this.fmt(c) : '—';
    },
    celulaTemValor(dia: DiaCalculado, tipo: TipoLancamento): boolean {
      return (tipo === 'saida' ? dia.saidasCentavos : dia.entradasCentavos) > 0;
    },
    /** Clique na célula: abre a modal de novo lançamento pré-preenchida com o dia. */
    abrirDia(dia: DiaCalculado, tipo: TipoLancamento) {
      this.abrirModalNovo(dia.data, tipo);
    },

    // ---- navegação de mês ----
    mudarMes(delta: number) {
      const { ano, mes } = parseMesKey(this.store.mesAtual);
      const total = ano * 12 + (mes - 1) + delta;
      this.store.irParaMes(toMesKey(Math.floor(total / 12), (total % 12) + 1));
    },
  };
}

// Expõe o factory e liga o Alpine.
(window as any).Alpine = Alpine;
Alpine.data('app', app);
Alpine.start();
