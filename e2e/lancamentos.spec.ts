import { expect, test, type Locator, type Page } from '@playwright/test';

// E2E do app de carteiras. Duas abas (Extrato / Diário) por carteira, valor
// diário manual, lançamentos isolados por carteira.

/** A folha (modal/bottom-sheet) que está por cima no momento. */
const sheet = (page: Page): Locator => page.locator('.modal-backdrop:visible').last().locator('.modal');

async function irAba(page: Page, nome: 'Extrato' | 'Diário') {
  await page.locator('.tabbar button').filter({ hasText: nome }).click();
}

async function definirValorDiario(page: Page, valor: string) {
  await page.locator('.carteira-switcher').click();
  await page.locator('.carteira-linha .icon').first().click(); // editar a carteira ativa
  await sheet(page).getByPlaceholder('0,00').fill(valor);
  await sheet(page).getByRole('button', { name: 'Salvar' }).click();
  await expect(page.locator('.modal-backdrop:visible')).toHaveCount(0);
}

async function novaCarteira(page: Page, nome: string, valorDiario: string) {
  await page.locator('.carteira-switcher').click();
  await page.getByRole('button', { name: '+ Nova carteira' }).click();
  await sheet(page).getByPlaceholder('ex.: Corrente, Vale-alimentação…').fill(nome);
  await sheet(page).getByPlaceholder('0,00').fill(valorDiario);
  await sheet(page).getByRole('button', { name: 'Salvar' }).click();
  await expect(page.locator('.modal-backdrop:visible')).toHaveCount(0);
}

async function trocarCarteira(page: Page, nome: string) {
  await page.locator('.carteira-switcher').click();
  await page.locator('.carteira-pick').filter({ hasText: nome }).click();
  await expect(page.locator('.modal-backdrop:visible')).toHaveCount(0);
}

async function novoLancamento(
  page: Page,
  opts: { tipo?: 'Saída' | 'Entrada'; valor: string; descricao: string; recorrente?: boolean },
) {
  await page.getByText('+ Novo lançamento').click();
  if (opts.tipo) await sheet(page).getByRole('button', { name: opts.tipo, exact: true }).click();
  await sheet(page).getByPlaceholder('0,00').fill(opts.valor);
  await sheet(page).getByPlaceholder('ex.: mercado, salário…').fill(opts.descricao);
  if (opts.recorrente) await sheet(page).getByRole('radio').nth(2).check(); // repetir até cancelar
  await sheet(page).getByRole('button', { name: 'Salvar' }).click();
  await expect(page.locator('.modal-backdrop:visible')).toHaveCount(0);
}

function item(page: Page, descricao: string) {
  return page.locator('.item-linha').filter({ hasText: descricao });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.tabbar')).toBeVisible();
});

test('carteira padrão "Corrente" e navegação por abas', async ({ page }) => {
  await expect(page.locator('.carteira-nome')).toHaveText('Corrente');
  await expect(page.locator('.tabbar button')).toHaveCount(2);

  await irAba(page, 'Extrato');
  await expect(page.getByText('+ Novo lançamento')).toBeVisible();
  await irAba(page, 'Diário');
  await expect(page.locator('.destaque-hoje')).toBeVisible();
});

test('valor diário manual reflete no "posso gastar por dia / semana"', async ({ page }) => {
  await definirValorDiario(page, '80,00');
  await irAba(page, 'Diário');
  const porDia = page.locator('.destaque-sub div').first();
  await expect(porDia).toContainText('Valor diário');
  await expect(porDia.locator('strong')).toHaveText('R$ 80,00');
  await expect(page.locator('.destaque-sub div').nth(1).locator('strong')).toHaveText('R$ 560,00'); // ×7
  // com valor diário > 0, o saldo de hoje acumulou algo (não é 0 nem "—")
  const hoje = await page.locator('.destaque-hoje strong').innerText();
  expect(hoje).not.toBe('—');
  expect(hoje).not.toBe('R$ 0,00');
});

test('lançamento aparece no Extrato e reflete no Diário', async ({ page }) => {
  await definirValorDiario(page, '80,00');
  await irAba(page, 'Extrato');
  await novoLancamento(page, { tipo: 'Saída', valor: '50,00', descricao: 'mercado' });
  await expect(item(page, 'mercado')).toBeVisible();

  await irAba(page, 'Diário');
  // a saída de hoje aparece cheia na célula de saída da linha de hoje
  await expect(page.locator('.planilha tr.hoje .celula.saida')).toHaveText('R$ 50,00');
});

test('carteiras são isoladas: lançamento de uma não aparece na outra', async ({ page }) => {
  await irAba(page, 'Extrato');
  await novoLancamento(page, { tipo: 'Saída', valor: '30,00', descricao: 'cafe-corrente' });

  await novaCarteira(page, 'Vale', '40,00'); // já foca na Vale
  await expect(page.locator('.carteira-nome')).toHaveText('Vale');
  await irAba(page, 'Extrato');
  await expect(item(page, 'cafe-corrente')).toHaveCount(0); // não vaza pra Vale
  await novoLancamento(page, { tipo: 'Saída', valor: '15,00', descricao: 'lanche-vale' });
  await expect(item(page, 'lanche-vale')).toBeVisible();

  await trocarCarteira(page, 'Corrente');
  await irAba(page, 'Extrato');
  await expect(item(page, 'cafe-corrente')).toBeVisible();
  await expect(item(page, 'lanche-vale')).toHaveCount(0);
});

test('recorrência aparece nos meses seguintes', async ({ page }) => {
  await irAba(page, 'Extrato');
  await novoLancamento(page, { tipo: 'Entrada', valor: '4000,00', descricao: 'Salário', recorrente: true });
  await expect(item(page, 'Salário')).toContainText('recorrente');

  await page.getByRole('button', { name: 'Próximo mês' }).click();
  await expect(item(page, 'Salário')).toBeVisible(); // segue recorrendo
});
