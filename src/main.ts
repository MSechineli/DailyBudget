import Alpine from 'alpinejs';
import { Store } from './store.ts';
import {
  agregadoMesDe,
  calcularMesDe,
  custoDiarioMedio,
  fixosMes,
  rendaMes,
  resumoMesDe,
  totalFixosMes,
} from './data/derive.ts';
import type { DiaCalculado } from './data/domain.ts';
import { formatBRL, parseBRLToCentavos } from './data/money.ts';
import { hojeISO, parseMesKey, toMesKey } from './data/dates.ts';
import type { TipoLancamento } from './data/schema.ts';
import './style.css';

// Componente principal do Alpine: a planilha diária. Uma linha por dia do mês,
// com as células de Saída/Entrada editáveis direto (um valor por dia), e o saldo
// acumulando. Config (salário + custos fixos) num painel colapsável.
//
// IMPORTANTE: todo acesso ao store é via `this.store` (o proxy reativo do
// Alpine), nunca por variável de closure — senão o re-render não dispara.
function app() {
  return {
    store: new Store(),
    configAberta: false,
    hoje: hojeISO(),
    // form de novo custo fixo
    novoFixo: { nome: '', valor: '' },

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
    get fixosFmt(): string {
      return this.pronto ? formatBRL(totalFixosMes(this.store.dados, this.store.mesAtual)) : '—';
    },
    get custoDiarioFmt(): string {
      if (!this.pronto) return '—';
      return formatBRL(Math.round(custoDiarioMedio(this.store.dados, this.store.mesAtual)));
    },
    get saldoFinalFmt(): string {
      if (!this.pronto) return '—';
      return formatBRL(agregadoMesDe(this.store.dados, this.store.mesAtual).saldoFinalCentavos);
    },
    /** true quando custos fixos ≥ renda (sobra ≤ 0). UI mostra aviso. */
    get fixosMaioresQueRenda(): boolean {
      if (!this.pronto) return false;
      return resumoMesDe(this.store.dados, this.store.mesAtual).sobraCentavos <= 0;
    },

    // ---- config ----
    /** Salário do mês em centavos (crus), para os inputs de config. */
    rendaMes(): number {
      return this.pronto ? rendaMes(this.store.dados, this.store.mesAtual) : 0;
    },
    get custosFixos() {
      return this.pronto ? fixosMes(this.store.dados, this.store.mesAtual) : [];
    },
    /** Valor para edição (reais, sem "R$"); vazio quando 0. */
    plain(centavos: number): string {
      return centavos ? formatBRL(centavos).replace('R$', '').trim() : '';
    },
    editarRenda(txt: string) {
      this.store.setRenda(parseBRLToCentavos(txt) ?? 0);
    },
    addFixo() {
      const c = parseBRLToCentavos(this.novoFixo.valor);
      const nome = this.novoFixo.nome.trim();
      if (!nome || c === null || c <= 0) return;
      this.store.addCustoFixo(nome, c);
      this.novoFixo.nome = '';
      this.novoFixo.valor = '';
    },
    editarFixoNome(id: string, txt: string) {
      this.store.atualizarCustoFixo(id, { nome: txt });
    },
    editarFixoValor(id: string, txt: string) {
      this.store.atualizarCustoFixo(id, { valorCentavos: parseBRLToCentavos(txt) ?? 0 });
    },
    removerFixo(id: string) {
      this.store.removerCustoFixo(id);
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
    ehHoje(data: string): boolean {
      return data === this.hoje;
    },
    /** dd/mm de uma data ISO. */
    diaMes(data: string): string {
      return `${data.slice(8, 10)}/${data.slice(5, 7)}`;
    },
    /** Valor da célula (Saída/Entrada) para edição. */
    valorCelula(dia: DiaCalculado, tipo: TipoLancamento): string {
      const c = tipo === 'saida' ? dia.saidasCentavos : dia.entradasCentavos;
      return this.plain(c);
    },
    /** Grava o valor digitado numa célula (texto vazio => remove o dia). */
    editarCelula(dia: DiaCalculado, tipo: TipoLancamento, texto: string) {
      const t = texto.trim();
      const centavos = t === '' ? null : parseBRLToCentavos(t);
      // texto inválido: ignora (a célula volta pro valor atual no próximo render).
      if (t !== '' && centavos === null) return;
      this.store.setValorDia(dia.data, tipo, centavos);
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
