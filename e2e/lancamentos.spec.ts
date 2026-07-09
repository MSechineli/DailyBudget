import { expect, test, type Page } from '@playwright/test';

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
  opts: { tipo?: 'Saída' | 'Entrada'; valor: string; descricao: string },
) {
  if (opts.tipo) await page.getByRole('button', { name: opts.tipo, exact: true }).click();
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

test('o saldo acumulado de um mês rola pro início do mês seguinte', async ({ page }) => {
  // sem nenhum lançamento, saldo inicial começa em zero
  await expect(page.locator('.painel-final strong')).toHaveText('R$ 0,00');

  await abrirNovoLancamento(page);
  await preencherModal(page, { tipo: 'Entrada', valor: '1000,00', descricao: 'Freela' });
  await salvarModal(page);

  const saldoFinalMesAtual = await page.locator('.painel-final strong').innerText();
  expect(saldoFinalMesAtual).toBe('R$ 1.000,00'); // sem renda/fixos configurados, sobra 0 + entrada avulsa

  await page.getByRole('button', { name: 'Próximo mês' }).click();

  // mês seguinte começa com o saldo final do mês anterior como saldo inicial
  const saldoInicial = page.locator('.painel div').filter({ hasText: 'Saldo inicial' }).locator('strong');
  await expect(saldoInicial).toHaveText('R$ 1.000,00');
  // sem nova atividade, o saldo final do novo mês é igual ao inicial
  await expect(page.locator('.painel-final strong')).toHaveText('R$ 1.000,00');

  // o saldo herdado é diluído pelos dias do mês, não aparece cheio já no dia 1
  const saldoDia1 = await page.locator('.planilha .saldo').first().innerText();
  expect(saldoDia1).not.toBe('R$ 1.000,00');
});
