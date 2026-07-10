import { expect, test, type Locator, type Page } from '@playwright/test';

// Testes E2E do fluxo de lançamentos (avulsos e recorrentes) na modal e na
// lista "Lançamentos do mês". Cobre os casos de uso centrais: replanejamento
// dinâmico do saldo (cada lançamento é diluído pelos dias restantes do mês, a
// partir do dia em que aconteceu) e editar uma série recorrente "daqui pra
// frente" sem afetar meses passados.

async function abrirNovoLancamento(page: Page) {
  await page.getByText('+ Novo lançamento').click();
}

async function preencherModal(
  page: Page,
  opts: {
    tipo?: 'Saída' | 'Entrada';
    valor: string;
    descricao: string;
    categoria?: 'Conta do mês' | 'Gasto do dia';
  },
) {
  if (opts.tipo) await page.getByRole('button', { name: opts.tipo, exact: true }).click();
  if (opts.categoria) await page.getByRole('button', { name: opts.categoria, exact: true }).click();
  await page.getByPlaceholder('0,00').fill(opts.valor);
  await page.getByPlaceholder('ex.: mercado, aluguel…').fill(opts.descricao);
}

async function salvarModal(page: Page) {
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.locator('.modal-backdrop')).toBeHidden();
}

async function abrirLista(page: Page) {
  await page.getByText('📋 Lançamentos do mês').click();
}

function itemLinha(page: Page, descricao: string) {
  return page.locator('.item-linha').filter({ hasText: descricao });
}

/** Espelha src/data/money.ts formatBRL, pra comparar sem depender de Intl/locale do runner. */
function formatBRL(centavos: number): string {
  const sinal = centavos < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(centavos));
  const reais = Math.floor(abs / 100);
  const cents = abs % 100;
  return `${sinal}R$ ${reais.toLocaleString('pt-BR')},${String(cents).padStart(2, '0')}`;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('📋 Lançamentos do mês')).toBeVisible();
  await abrirLista(page);
});

test('mês novo começa sem lançamentos', async ({ page }) => {
  await expect(page.getByText('Nenhum lançamento neste mês ainda.')).toBeVisible();
  await expect(page.locator('.item-linha')).toHaveCount(0);
});

test('série indefinida (salário) entra suavizada no orçamento do mês inteiro', async ({ page }) => {
  await abrirNovoLancamento(page);
  await preencherModal(page, { tipo: 'Entrada', valor: '4000,00', descricao: 'Salário' });
  await page.getByRole('radio').nth(2).check(); // "Repetir todo mês até cancelar"
  await salvarModal(page);

  await expect(itemLinha(page, 'Salário')).toContainText('recorrente · sem fim');
  await expect(itemLinha(page, 'Salário')).toContainText('R$ 4.000,00');

  // painel resumo reflete a renda do mês
  await expect(page.locator('.painel')).toContainText('R$ 4.000,00');
  // último dia do mês fecha exatamente na sobra (sem custo fixo, sobra = renda)
  const ultimaLinha = page.locator('.planilha tbody tr').last();
  await expect(ultimaLinha.locator('.saldo')).toHaveText('R$ 4.000,00');
});

test('série de N meses calcula o fim corretamente e some da lista após o fim', async ({ page }) => {
  await abrirNovoLancamento(page);
  await preencherModal(page, { tipo: 'Saída', valor: '50,00', descricao: 'Assinatura' });
  await page.getByRole('radio').nth(1).check(); // "Repetir por N meses"
  await page.locator('.input-meses').fill('2');
  await salvarModal(page);

  await expect(itemLinha(page, 'Assinatura')).toBeVisible();

  // avança 2 meses: ainda deve estar ativa (mesFim inclusive)
  await page.getByRole('button', { name: 'Próximo mês' }).click();
  await expect(itemLinha(page, 'Assinatura')).toBeVisible();

  // avança mais um mês: já passou do fim, some da lista
  await page.getByRole('button', { name: 'Próximo mês' }).click();
  await expect(itemLinha(page, 'Assinatura')).toHaveCount(0);
});

test('lançamento avulso (sem recorrência) aparece na célula do dia exato em que aconteceu', async ({ page }) => {
  await page.locator('.celula.saida').first().click(); // clica na célula do dia 1
  await preencherModal(page, { valor: '30,00', descricao: 'mercado' });
  await expect(page.locator('input[type="radio"][value="nenhuma"]')).toBeChecked();
  await salvarModal(page);

  await expect(page.locator('.celula.saida').first()).toHaveText('R$ 30,00');
  await expect(page.locator('.celula.saida').nth(1)).toHaveText('—'); // dia 2 não afetado
  await expect(itemLinha(page, 'mercado')).toContainText('01/');
});

test('lançamento avulso é diluído pelos dias que restam do mês, não bate tudo de uma vez no saldo', async ({ page }) => {
  // sem nenhum lançamento ainda, sobra 0 → saldo do dia 1 é 0
  await expect(page.locator('.planilha .saldo').first()).toHaveText('R$ 0,00');

  const totalDias = await page.locator('.planilha tbody tr').count();
  const diaMeio = Math.floor(totalDias / 2); // linha no meio do mês, index 0-based

  // lança uma entrada avulsa de R$ 3.000,00 no meio do mês
  await page.locator('.celula.entrada').nth(diaMeio).click();
  await preencherModal(page, { valor: '3000,00', descricao: 'bônus' });
  await salvarModal(page);

  const diasRestantes = totalDias - diaMeio; // inclui o próprio dia do lançamento
  const parcelaEsperada = Math.round(300000 / diasRestantes); // 300000 centavos = R$ 3.000,00

  const saldoNoDia = await page.locator('.planilha .saldo').nth(diaMeio).innerText();
  // o saldo naquele dia é só a fatia (bônus / dias restantes), não os R$ 3.000 inteiros
  expect(saldoNoDia).not.toBe('R$ 3.000,00');
  expect(saldoNoDia).toBe(formatBRL(parcelaEsperada));

  // o dia anterior ao lançamento não é afetado (evento só conta a partir do próprio dia)
  await expect(page.locator('.planilha .saldo').nth(diaMeio - 1)).toHaveText('R$ 0,00');

  // no último dia do mês, os R$ 3.000 inteiros já foram totalmente somados
  await expect(page.locator('.planilha .saldo').last()).toHaveText('R$ 3.000,00');
});

test('editar série "daqui pra frente" no mês seguinte não altera o mês passado', async ({ page }) => {
  await abrirNovoLancamento(page);
  await preencherModal(page, { tipo: 'Saída', valor: '50,00', descricao: 'Assinatura streaming' });
  await page.getByRole('radio').nth(2).check(); // indefinida
  await salvarModal(page);

  await page.getByRole('button', { name: 'Próximo mês' }).click();

  await itemLinha(page, 'Assinatura streaming').getByRole('button', { name: 'Editar' }).click();
  await expect(page.getByText('Editar série (daqui pra frente)')).toBeVisible();
  await page.getByPlaceholder('0,00').fill('70,00');
  await salvarModal(page);

  await expect(itemLinha(page, 'Assinatura streaming')).toContainText('R$ 70,00');

  // mês anterior continua com o valor original
  await page.getByRole('button', { name: 'Mês anterior' }).click();
  await expect(itemLinha(page, 'Assinatura streaming')).toContainText('R$ 50,00');
});

test('encerrar série a partir de um mês futuro preserva o histórico', async ({ page }) => {
  await abrirNovoLancamento(page);
  await preencherModal(page, { tipo: 'Saída', valor: '20,00', descricao: 'Academia' });
  await page.getByRole('radio').nth(2).check();
  await salvarModal(page);

  await page.getByRole('button', { name: 'Próximo mês' }).click();

  page.once('dialog', (d) => d.accept());
  await itemLinha(page, 'Academia').getByRole('button', { name: 'Encerrar' }).click();
  await expect(itemLinha(page, 'Academia')).toHaveCount(0);

  await page.getByRole('button', { name: 'Mês anterior' }).click();
  await expect(itemLinha(page, 'Academia')).toBeVisible();
});

test('excluir avulso remove só aquele lançamento', async ({ page }) => {
  await page.locator('.celula.saida').first().click();
  await preencherModal(page, { valor: '15,00', descricao: 'padaria' });
  await salvarModal(page);

  page.once('dialog', (d) => d.accept());
  await itemLinha(page, 'padaria').getByRole('button', { name: 'Remover' }).click();
  await expect(itemLinha(page, 'padaria')).toHaveCount(0);
  await expect(page.locator('.celula.saida').first()).toHaveText('—');
});

function saldoFinal(page: Page) {
  return page.locator('.painel div').filter({ hasText: 'Saldo final' }).locator('strong');
}

function saldoInicial(page: Page) {
  return page.locator('.painel div').filter({ hasText: 'Saldo inicial' }).locator('strong');
}

test('saída avulsa bate na hora (cheia) e o saldo recupera nos dias seguintes', async ({ page }) => {
  // salário recorrente pra ter budget diário; sobra 3000, custo/dia > 0
  await abrirNovoLancamento(page);
  await preencherModal(page, { tipo: 'Entrada', valor: '3000,00', descricao: 'Salário' });
  await page.getByRole('radio').nth(2).check(); // indefinida
  await salvarModal(page);

  // sem lançamento, saldo cresce só pelo budget diário: saldo(dia i) = daily·i
  const cents = (loc: Locator) =>
    loc.innerText().then((t) => (t.includes('-') ? -1 : 1) * Number(t.replace(/[^0-9]/g, '')));
  const saldo = (i: number) => cents(page.locator('.planilha .saldo').nth(i)); // i = 0-based (dia i+1)

  const saldoDia4Antes = await saldo(3);
  const saldoDia5Antes = await saldo(4);
  const daily = saldoDia5Antes - saldoDia4Antes; // budget diário ≈ 3000/dias do mês

  // registra uma saída avulsa de R$ 500 no dia 5
  await page.locator('.planilha tbody tr').nth(4).locator('.celula.saida').click();
  await preencherModal(page, { valor: '500,00', descricao: 'compra' });
  await salvarModal(page);

  const saldoDia4 = await saldo(3);
  const saldoDia5 = await saldo(4);
  const saldoDia6 = await saldo(5);

  // dia anterior à saída não muda
  expect(saldoDia4).toBe(saldoDia4Antes);
  // a saída bate CHEIA no dia 5: cai ~R$ 500 (menos o budget do dia), não uma fração diluída
  expect(saldoDia4 - saldoDia5).toBeGreaterThan(40000); // > R$ 400 de queda
  // recupera: dia 6 sobe de novo ~um budget diário (não os 500 de volta), ±1 de arredondamento
  expect(saldoDia6 - saldoDia5).toBeGreaterThan(0);
  expect(Math.abs(saldoDia6 - saldoDia5 - daily)).toBeLessThanOrEqual(1);
});

test('o saldo acumulado de um mês rola pro início do mês seguinte (imediato)', async ({ page }) => {
  // sem nenhum lançamento, saldo final começa em zero
  await expect(saldoFinal(page)).toHaveText('R$ 0,00');

  await abrirNovoLancamento(page);
  await preencherModal(page, { tipo: 'Entrada', valor: '1000,00', descricao: 'Freela' });
  await salvarModal(page);

  // sem renda/fixos recorrentes, sobra 0 + entrada avulsa → saldo final 1000
  await expect(saldoFinal(page)).toHaveText('R$ 1.000,00');

  await page.getByRole('button', { name: 'Próximo mês' }).click();

  // mês seguinte herda o saldo como saldo inicial, IMEDIATO já no dia 1
  await expect(saldoInicial(page)).toHaveText('R$ 1.000,00');
  await expect(saldoFinal(page)).toHaveText('R$ 1.000,00');
  // sobra 0 → saldo é constante e igual ao herdado em todos os dias, inclusive o 1º
  await expect(page.locator('.planilha .saldo').first()).toHaveText('R$ 1.000,00');
});

test('painel "posso gastar" e gráfico do saldo aparecem', async ({ page }) => {
  await abrirNovoLancamento(page);
  await preencherModal(page, { tipo: 'Entrada', valor: '3000,00', descricao: 'Salário' });
  await page.getByRole('radio').nth(2).check();
  await salvarModal(page);

  // destaque "posso gastar hoje" + por dia/semana
  await expect(page.locator('.destaque-hoje strong')).toBeVisible();
  await expect(page.locator('.destaque-sub')).toContainText('Por dia');
  await expect(page.locator('.destaque-sub')).toContainText('Por semana');
  // gráfico SVG renderizado
  await expect(page.locator('svg.grafico')).toBeVisible();
});

const sobraLivre = (page: Page) =>
  page.locator('.resumo-linha.total strong');

test('conta debita do bolo (sobra livre cai, sem vermelho); gasto debita no dia (pode ficar vermelho)', async ({ page }) => {
  // salário recorrente pra ter renda
  await abrirNovoLancamento(page);
  await preencherModal(page, { tipo: 'Entrada', valor: '3000,00', descricao: 'Salário' });
  await page.getByRole('radio').nth(2).check(); // indefinida
  await salvarModal(page);
  await expect(sobraLivre(page)).toHaveText('R$ 3.000,00'); // sem contas ainda

  // uma CONTA avulsa (cartão): debita do bolo → sobra livre cai, e NÃO fica vermelho
  await abrirNovoLancamento(page);
  await preencherModal(page, { tipo: 'Saída', categoria: 'Conta do mês', valor: '1000,00', descricao: 'Cartão' });
  await salvarModal(page);
  await expect(sobraLivre(page)).toHaveText('R$ 2.000,00'); // 3000 − 1000
  await expect(itemLinha(page, 'Cartão')).toContainText('conta'); // badge
  // nenhum dia da planilha fica vermelho por causa da conta
  await expect(page.locator('.planilha .saldo.vermelho')).toHaveCount(0);

  // um GASTO grande hoje: debita imediato no dia → pode ficar vermelho
  const temHoje = await page.locator('.planilha tr.hoje').count();
  test.skip(temHoje === 0, 'mês exibido não contém hoje');
  await page.locator('.planilha tr.hoje .celula.saida').click();
  await preencherModal(page, { categoria: 'Gasto do dia', valor: '5000,00', descricao: 'compra grande' });
  await salvarModal(page);
  // a sobra livre NÃO muda (gasto não é conta), mas o saldo de hoje despenca
  await expect(sobraLivre(page)).toHaveText('R$ 2.000,00');
  await expect(page.locator('.planilha tr.hoje .saldo.vermelho')).toHaveCount(1);
});
