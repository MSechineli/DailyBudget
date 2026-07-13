import Alpine from 'alpinejs';
import { Store, type Recorrencia } from './store.ts';
import {
  agregadoMesDe,
  calcularMesDe,
  carteirasVivas,
  custoDiarioMedio,
  itensDoMes,
  saldoInicialMes,
  valorDiario,
  type ItemMes,
} from './data/derive.ts';
import type { DiaCalculado } from './data/domain.ts';
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
  data: string; // 'YYYY-MM-DD'
  valor: string; // texto BRL, ex.: "19,90"
  descricao: string;
  recorrenciaTipo: 'nenhuma' | 'nMeses' | 'indefinida';
  recorrenciaMeses: string;
}

interface CarteiraForm {
  modo: 'nova' | 'editar';
  id: string | null;
  nome: string;
  valorDiario: string; // texto BRL
}

// App financeiro com múltiplas CARTEIRAS. Duas abas por carteira: Extrato (lista
// clássica de lançamentos) e Diário (a visualização de valor diário rolante).
// Cada carteira tem um valor diário manual.
//
// IMPORTANTE: todo acesso ao store é via `this.store` (o proxy reativo do
// Alpine), nunca por variável de closure — senão o re-render não dispara.
function app() {
  return {
    store: new Store(),
    aba: 'diario' as Aba,
    hoje: hojeISO(),

    // ---- overlays ----
    modalAberto: false,
    modalModo: 'novo' as ModalModo,
    modalAlvoId: null as string | null,
    modalForm: {
      tipo: 'saida',
      data: hojeISO(),
      valor: '',
      descricao: '',
      recorrenciaTipo: 'nenhuma',
      recorrenciaMeses: '3',
    } as ModalForm,

    carteirasAberto: false,
    carteiraFormAberto: false,
    carteiraForm: { modo: 'nova', id: null, nome: '', valorDiario: '' } as CarteiraForm,

    async init() {
      await this.store.init();
    },

    // ---- helpers de exibição ----
    fmt: formatBRL,

    get pronto(): boolean {
      return this.store.estado === 'pronto';
    },

    /** id da carteira ativa (atalho). */
    get cid(): string {
      return this.store.carteiraAtualId;
    },

    get mesLabel(): string {
      const { ano, mes } = parseMesKey(this.store.mesAtual);
      const nomes = [
        'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
        'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
      ];
      return `${nomes[mes - 1]} / ${ano}`;
    },

    // ---- carteiras ----
    get carteiras(): Carteira[] {
      return this.pronto ? carteirasVivas(this.store.dados) : [];
    },
    get carteiraNome(): string {
      return this.store.carteiraAtual?.nome ?? '—';
    },
    /** Valor diário (manual) da carteira ativa, formatado. */
    get valorDiarioFmt(): string {
      return this.pronto ? formatBRL(valorDiario(this.store.dados, this.cid)) : '—';
    },
    selecionarCarteira(id: string) {
      this.store.irParaCarteira(id);
      this.carteirasAberto = false;
    },
    abrirNovaCarteira() {
      this.carteiraForm = { modo: 'nova', id: null, nome: '', valorDiario: '' };
      this.carteiraFormAberto = true;
    },
    abrirEditarCarteira(c: Carteira) {
      this.carteiraForm = {
        modo: 'editar',
        id: c.id,
        nome: c.nome,
        valorDiario: this.plain(c.valorDiarioCentavos),
      };
      this.carteiraFormAberto = true;
    },
    salvarCarteira() {
      const nome = this.carteiraForm.nome.trim();
      if (!nome) return;
      const valor = parseBRLToCentavos(this.carteiraForm.valorDiario) ?? 0;
      if (this.carteiraForm.modo === 'nova') {
        this.store.adicionarCarteira(nome, valor);
      } else if (this.carteiraForm.id) {
        this.store.atualizarCarteira(this.carteiraForm.id, { nome, valorDiarioCentavos: valor });
      }
      this.carteiraFormAberto = false;
      this.carteirasAberto = false;
    },
    excluirCarteira(c: Carteira) {
      if (this.carteiras.length <= 1) {
        alert('Você precisa de pelo menos uma carteira.');
        return;
      }
      if (!confirm(`Excluir a carteira "${c.nome}" e seus lançamentos?`)) return;
      this.store.removerCarteira(c.id);
      this.carteiraFormAberto = false;
    },

    // ---- resumo diário ----
    get custoDiarioFmt(): string {
      if (!this.pronto) return '—';
      return formatBRL(Math.round(custoDiarioMedio(this.store.dados, this.cid, this.store.mesAtual)));
    },
    get porSemanaFmt(): string {
      if (!this.pronto) return '—';
      return formatBRL(
        Math.round(custoDiarioMedio(this.store.dados, this.cid, this.store.mesAtual) * 7),
      );
    },
    get saldoFinalFmt(): string {
      if (!this.pronto) return '—';
      return formatBRL(agregadoMesDe(this.store.dados, this.cid, this.store.mesAtual).saldoFinalCentavos);
    },
    get saldoInicialFmt(): string {
      if (!this.pronto) return '—';
      return formatBRL(saldoInicialMes(this.store.dados, this.cid, this.store.mesAtual));
    },

    // ---- quanto posso gastar (hoje / dia / semana) ----
    get diaDeHoje(): DiaCalculado | null {
      return this.dias.find((d) => d.data === this.hoje) ?? null;
    },
    get disponivelHojeFmt(): string {
      const hoje = this.diaDeHoje;
      return hoje ? formatBRL(hoje.saldoCentavos) : '—';
    },
    get disponivelHojeVermelho(): boolean {
      const hoje = this.diaDeHoje;
      return hoje ? hoje.saldoCentavos < 0 : false;
    },

    // ---- Extrato: lançamentos do mês (avulsos + séries) ----
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
        tipo: item.tipo,
        data: item.data,
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
        data: item.data,
        valor: this.plain(item.valorCentavos),
        descricao: item.descricao,
        recorrenciaTipo: 'nenhuma',
        recorrenciaMeses: '3',
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
    abrirModalNovo(data?: string, tipo?: TipoLancamento) {
      this.modalModo = 'novo';
      this.modalAlvoId = null;
      this.modalForm = {
        tipo: tipo ?? 'saida',
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

    // ---- planilha diária ----
    get dias(): DiaCalculado[] {
      return this.pronto ? calcularMesDe(this.store.dados, this.cid, this.store.mesAtual) : [];
    },

    /** Geometria do gráfico de saldo do mês (SVG inline). */
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
      const span = max - min || 1;
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
      return { w, h, linha, area, zeroY, zeroFrac: zeroY / h, hojeX: hojeIdx >= 0 ? x(hojeIdx) : null };
    },
    ehHoje(data: string): boolean {
      return data === this.hoje;
    },
    diaMes(data: string): string {
      return `${data.slice(8, 10)}/${data.slice(5, 7)}`;
    },
    celulaFmt(dia: DiaCalculado, tipo: TipoLancamento): string {
      const c = tipo === 'saida' ? dia.saidasCentavos : dia.entradasCentavos;
      return c ? this.fmt(c) : '—';
    },
    celulaTemValor(dia: DiaCalculado, tipo: TipoLancamento): boolean {
      return (tipo === 'saida' ? dia.saidasCentavos : dia.entradasCentavos) > 0;
    },
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

// Service worker (PWA, registerType 'autoUpdate'): registramos manualmente pra
// poder checar atualização com frequência. Sem isso, uma aba já aberta pode
// demorar MUITO pra perceber um deploy novo. Com autoUpdate, assim que o SW novo
// é detectado ele ativa e a página recarrega sozinha (sem F5).
// Obs: o piso de ~10 min é da CDN do GitHub Pages (cache do sw.js/index.html,
// não configurável); isso aqui só garante que a aba pega a versão nova assim que
// a CDN liberar. Pra atualização instantânea, migrar pro Cloudflare Pages.
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
