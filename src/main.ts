import Alpine from 'alpinejs';
import { Store, type Recorrencia } from './store.ts';
import {
  carteirasVivas,
  itensDoMes,
  previsaoDe,
  projecaoLedger,
  type DiaProjecao,
  type ItemMes,
  type Previsao,
} from './data/derive.ts';
import type { Carteira } from './data/schema.ts';
import { formatBRL, parseBRLToCentavos } from './data/money.ts';
import { hojeISO, mesKeyDeData, parseMesKey, toMesKey } from './data/dates.ts';
import type { TipoLancamento } from './data/schema.ts';
import { registerSW } from 'virtual:pwa-register';
import './style.css';

type Aba = 'extrato' | 'diario';
type ModalModo = 'novo' | 'editarSerie' | 'editarLancamento';

interface ModalForm {
  tipo: TipoLancamento;
  data: string;
  valor: string;
  descricao: string;
  recorrenciaTipo: 'nenhuma' | 'nMeses' | 'indefinida';
  recorrenciaMeses: string;
}

interface CarteiraForm {
  modo: 'nova' | 'editar';
  id: string | null;
  nome: string;
}

// App financeiro com PREVISÃO. Cada carteira tem Extrato (lançamentos) e Diário
// (painel de previsão: saldo, orçamento/dia = saldo ÷ dias até a renda, ISF,
// data que o dinheiro acaba, projeção verde/vermelho). Ver DOMINIO.md.
function app() {
  return {
    store: new Store(),
    aba: 'diario' as Aba,
    hoje: hojeISO(),

    modalAberto: false,
    modalModo: 'novo' as ModalModo,
    modalAlvoId: null as string | null,
    modalForm: {
      tipo: 'saida', data: hojeISO(), valor: '', descricao: '',
      recorrenciaTipo: 'nenhuma', recorrenciaMeses: '3',
    } as ModalForm,

    carteirasAberto: false,
    carteiraFormAberto: false,
    carteiraForm: { modo: 'nova', id: null, nome: '' } as CarteiraForm,

    horizonte: 60, // dias mostrados no dia a dia; "Ver mais dias" soma +60

    async init() {
      await this.store.init();
    },

    fmt: formatBRL,

    get pronto(): boolean {
      return this.store.estado === 'pronto';
    },
    get cid(): string {
      return this.store.carteiraAtualId;
    },
    get mesLabel(): string {
      const { ano, mes } = parseMesKey(this.store.mesAtual);
      const nomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
        'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
      return `${nomes[mes - 1]} / ${ano}`;
    },
    /** dd/mm/aaaa de uma data ISO. */
    dataBR(iso: string | null): string {
      if (!iso) return '—';
      return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
    },
    /** dd/mm de uma data ISO (Extrato). */
    diaMes(data: string): string {
      return `${data.slice(8, 10)}/${data.slice(5, 7)}`;
    },
    plain(centavos: number): string {
      return centavos ? formatBRL(centavos).replace('R$', '').trim() : '';
    },
    /** Valor sem "R$" (pro dia a dia, onde o cabeçalho já diz que é dinheiro). */
    valorSimples(centavos: number): string {
      return formatBRL(centavos).replace('R$', '').trim();
    },

    // ---- carteiras ----
    get carteiras(): Carteira[] {
      return this.pronto ? carteirasVivas(this.store.dados) : [];
    },
    get carteiraNome(): string {
      return this.store.carteiraAtual?.nome ?? '—';
    },
    selecionarCarteira(id: string) {
      this.store.irParaCarteira(id);
      this.horizonte = 60; // reinicia o horizonte do dia a dia ao trocar de carteira
      this.carteirasAberto = false;
    },
    abrirNovaCarteira() {
      this.carteiraForm = { modo: 'nova', id: null, nome: '' };
      this.carteiraFormAberto = true;
    },
    abrirEditarCarteira(c: Carteira) {
      this.carteiraForm = { modo: 'editar', id: c.id, nome: c.nome };
      this.carteiraFormAberto = true;
    },
    salvarCarteira() {
      const nome = this.carteiraForm.nome.trim();
      if (!nome) return;
      if (this.carteiraForm.modo === 'nova') {
        this.store.adicionarCarteira(nome);
      } else if (this.carteiraForm.id) {
        this.store.atualizarCarteira(this.carteiraForm.id, { nome });
      }
      this.carteiraFormAberto = false;
      this.carteirasAberto = false;
    },
    excluirCarteira(c: Carteira | undefined) {
      if (!c) return;
      if (this.carteiras.length <= 1) {
        alert('Você precisa de pelo menos uma carteira.');
        return;
      }
      if (!confirm(`Excluir a carteira "${c.nome}" e seus lançamentos?`)) return;
      this.store.removerCarteira(c.id);
      this.carteiraFormAberto = false;
    },

    // ---- previsão (Diário) ----
    get previsao(): Previsao | null {
      return this.pronto ? previsaoDe(this.store.dados, this.cid, this.hoje) : null;
    },
    get temRenda(): boolean {
      return (this.previsao?.diasAteRenda ?? null) !== null;
    },
    get saldoAtualFmt(): string {
      return this.previsao ? formatBRL(this.previsao.saldoAtualCentavos) : '—';
    },
    get saldoNegativo(): boolean {
      return (this.previsao?.saldoAtualCentavos ?? 0) < 0;
    },
    get orcamentoFmt(): string {
      const c = this.previsao?.orcamentoDiarioCentavos;
      return c === null || c === undefined ? '—' : formatBRL(c);
    },
    get mediaFmt(): string {
      return this.previsao ? formatBRL(this.previsao.mediaDiariaCentavos) : '—';
    },
    /** Texto do desvio: "R$ X acima/abaixo" do orçamento (ou '—'). */
    get desvioTexto(): string {
      const d = this.previsao?.desvioCentavos;
      if (d === null || d === undefined) return '—';
      if (d === 0) return 'no orçamento';
      return `${formatBRL(Math.abs(d))} ${d > 0 ? 'acima' : 'abaixo'}`;
    },
    get desvioRuim(): boolean {
      return (this.previsao?.desvioCentavos ?? 0) > 0; // gastando acima = ruim
    },
    get diasAteRendaTexto(): string {
      const d = this.previsao?.diasAteRenda;
      return d === null || d === undefined ? '—' : `${d} ${d === 1 ? 'dia' : 'dias'}`;
    },
    get dataAcabaFmt(): string {
      return this.dataBR(this.previsao?.dataQueAcaba ?? null);
    },
    /** "N dias de folga" (verde) / "N dias de déficit" (vermelho) / '—'. */
    get folgaTexto(): string {
      const f = this.previsao?.folgaDeficitDias;
      if (f === null || f === undefined) return '—';
      if (f === 0) return 'no limite';
      const n = Math.abs(f);
      return `${n} ${n === 1 ? 'dia' : 'dias'} de ${f > 0 ? 'folga' : 'déficit'}`;
    },
    get folgaRuim(): boolean {
      return (this.previsao?.folgaDeficitDias ?? 0) < 0;
    },
    get isfLabel(): string {
      return this.previsao?.isf.label ?? '—';
    },
    /** Classe de cor do ISF: bom (verde) / atencao (amarelo) / ruim (vermelho). */
    get isfClasse(): string {
      const n = this.previsao?.isf.nivel;
      if (n === 'excelente' || n === 'seguro') return 'isf-bom';
      if (n === 'atencao') return 'isf-atencao';
      return 'isf-ruim';
    },
    get proximaRendaFmt(): string {
      return this.dataBR(this.previsao?.proximaRenda ?? null);
    },

    // ---- projeção: extrato corrido (dia a dia) ----
    /** Saldo corrido de hoje até hoje+horizonte (gasto/recebido/saldo por dia). */
    get ledger(): DiaProjecao[] {
      return this.pronto ? projecaoLedger(this.store.dados, this.cid, this.hoje, this.horizonte) : [];
    },

    /** Dia a dia com o status verde/vermelho pelo saldo corrente. */
    get diasProjecao(): (DiaProjecao & { status: 'verde' | 'vermelho' })[] {
      return this.ledger.map((d) => ({ ...d, status: d.saldoCentavos >= 0 ? 'verde' : 'vermelho' }));
    },

    verMaisDias() {
      this.horizonte += 60;
    },

    /** Gráfico do saldo corrido: uma linha/área verde→vermelho no cruzamento do zero. */
    get graficoProj(): {
      w: number; h: number; real: string; realArea: string; zeroY: number; zeroFrac: number;
    } | null {
      const saldos = this.ledger.map((d) => d.saldoCentavos);
      if (saldos.length < 2) return null;
      const w = 300, h = 90, pad = 6;
      const todos = [...saldos, 0];
      const min = Math.min(...todos), max = Math.max(...todos);
      const span = max - min || 1;
      const n = saldos.length;
      const x = (i: number) => pad + (i / (n - 1)) * (w - 2 * pad);
      const y = (v: number) => pad + (1 - (v - min) / span) * (h - 2 * pad);
      const linha = saldos
        .map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
        .join(' ');
      const zeroY = y(0);
      const realArea =
        `M${x(0).toFixed(1)},${zeroY.toFixed(1)} ` +
        saldos.map((v, i) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ') +
        ` L${x(n - 1).toFixed(1)},${zeroY.toFixed(1)} Z`;
      return { w, h, real: linha, realArea, zeroY, zeroFrac: zeroY / h };
    },

    // ---- Extrato ----
    get itensMes(): ItemMes[] {
      return this.pronto ? itensDoMes(this.store.dados, this.cid, this.store.mesAtual) : [];
    },
    serieFimLabel(item: ItemMes): string {
      if (item.origem !== 'serie') return '';
      return item.serie.mesFim === null ? 'sem fim' : `até ${item.serie.mesFim}`;
    },
    encerrarLabel(item: ItemMes): string {
      if (item.origem !== 'serie') return '';
      return item.serie.mesInicio === this.store.mesAtual ? 'Excluir' : 'Encerrar daqui';
    },
    abrirModalEditarSerie(item: ItemMes) {
      if (item.origem !== 'serie') return;
      this.modalModo = 'editarSerie';
      this.modalAlvoId = item.id;
      this.modalForm = {
        tipo: item.tipo, data: item.data, valor: this.plain(item.valorCentavos),
        descricao: item.descricao, recorrenciaTipo: 'nenhuma', recorrenciaMeses: '3',
      };
      this.modalAberto = true;
    },
    abrirModalEditarLancamento(item: ItemMes) {
      if (item.origem !== 'avulso') return;
      this.modalModo = 'editarLancamento';
      this.modalAlvoId = item.id;
      this.modalForm = {
        tipo: item.tipo, data: item.data, valor: this.plain(item.valorCentavos),
        descricao: item.descricao, recorrenciaTipo: 'nenhuma', recorrenciaMeses: '3',
      };
      this.modalAberto = true;
    },
    editarItem(item: ItemMes) {
      if (item.origem === 'serie') this.abrirModalEditarSerie(item);
      else this.abrirModalEditarLancamento(item);
    },
    removerItem(item: ItemMes) {
      if (item.origem === 'serie') {
        if (!confirm(`${this.encerrarLabel(item)} "${item.descricao}"?`)) return;
        this.store.encerrarSerieAPartir(item.id, this.store.mesAtual);
      } else {
        const rot = item.descricao || (item.tipo === 'saida' ? 'saída' : 'entrada');
        if (!confirm(`Excluir "${rot}"?`)) return;
        this.store.removerLancamento(item.id);
      }
    },

    // ---- modal de lançamento ----
    dataPadraoNoMes(): string {
      return mesKeyDeData(this.hoje) === this.store.mesAtual ? this.hoje : `${this.store.mesAtual}-01`;
    },
    abrirModalNovo(tipo?: TipoLancamento) {
      this.modalModo = 'novo';
      this.modalAlvoId = null;
      this.modalForm = {
        tipo: tipo ?? 'saida', data: this.dataPadraoNoMes(), valor: '', descricao: '',
        recorrenciaTipo: 'nenhuma', recorrenciaMeses: '3',
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
          data: this.modalForm.data, tipo: this.modalForm.tipo, valorCentavos,
          descricao: this.modalForm.descricao, recorrencia,
        });
      } else if (this.modalModo === 'editarSerie' && this.modalAlvoId) {
        this.store.editarSerieAPartir(this.modalAlvoId, this.store.mesAtual, {
          valorCentavos, descricao: this.modalForm.descricao,
        });
      } else if (this.modalModo === 'editarLancamento' && this.modalAlvoId) {
        this.store.atualizarLancamento(this.modalAlvoId, {
          tipo: this.modalForm.tipo, data: this.modalForm.data, valorCentavos,
          descricao: this.modalForm.descricao,
        });
      }
      this.fecharModal();
    },

    // ---- backup ----
    mensagemBackup: '' as string,
    exportar() {
      const json = JSON.stringify(this.store.exportar(), null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `financas-${hojeISO()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.mensagemBackup = 'Backup exportado ✓';
    },
    async importar(e: Event) {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      try {
        await this.store.importar(await file.text());
        this.store.carteiraAtualId = this.carteiras[0]?.id ?? '';
        this.mensagemBackup = 'Dados importados ✓';
      } catch (err) {
        this.mensagemBackup = `Falha ao importar: ${err instanceof Error ? err.message : 'arquivo inválido'}`;
      } finally {
        input.value = '';
      }
    },

    // ---- navegação de mês (Extrato) ----
    mudarMes(delta: number) {
      const { ano, mes } = parseMesKey(this.store.mesAtual);
      const total = ano * 12 + (mes - 1) + delta;
      this.store.irParaMes(toMesKey(Math.floor(total / 12), (total % 12) + 1));
    },
  };
}

(window as any).Alpine = Alpine;
Alpine.data('app', app);
Alpine.start();

// Service worker (PWA autoUpdate): registro manual pra checar update com
// frequência (60s + no visibilitychange). Ver commit da PWA / DOMINIO.
const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    setInterval(() => void registration.update(), 60_000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void registration.update();
    });
  },
});
void updateSW;
