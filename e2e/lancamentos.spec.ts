import { expect, test, type Locator, type Page } from '@playwright/test';

// E2E do app de previsão financeira. Cada carteira tem Extrato (lançamentos) e
// Diário (saldo atual, orçamento/dia = saldo ÷ dias até a próxima renda DERIVADA
// da próxima entrada futura, ISF, e o dia a dia = extrato corrido verde/vermelho).

const sheet = (page: Page): Locator => page.locator('.modal-backdrop:visible').last().locator('.modal');

async function irAba(page: Page, nome: 'Extrato' | 'Diário') {
  await page.locator('.tabbar button').filter({ hasText: nome }).click();
}

async function novoLancamento(
  page: Page,
  opts: { tipo?: 'Saída' | 'Entrada'; valor: string; descricao: string; data?: string },
) {
  await page.getByText('+ Novo lançamento').click();
  if (opts.tipo) await sheet(page).getByRole('button', { name: opts.tipo, exact: true }).click();
  await sheet(page).getByPlaceholder('0,00').fill(opts.valor);
  await sheet(page).getByPlaceholder('ex.: mercado, salário…').fill(opts.descricao);
  // sem `data`, fica no default (hoje) pra contar no saldo atual
  if (opts.data) await sheet(page).locator('input[type=date]').fill(opts.data);
  await sheet(page).getByRole('button', { name: 'Salvar' }).click();
  await expect(page.locator('.modal-backdrop:visible')).toHaveCount(0);
}

/** Data ISO daqui a `dias` dias (relativo ao "hoje" do runner). */
function emDias(page: Page, dias: number): Promise<string> {
  return page.evaluate((n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }, dias);
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
  await expect(page.locator('.destaque-hoje')).toContainText('Saldo atual');
});

test('sem entrada futura: Diário mostra a dica e não calcula orçamento', async ({ page }) => {
  await irAba(page, 'Diário');
  await expect(page.locator('.renda-cta')).toBeVisible();
  // orçamento/dia é o primeiro indicador; sem renda derivada fica "—"
  await expect(page.locator('.indicadores strong').first()).toHaveText('—');
});

test('lançamentos alimentam o saldo e a previsão (renda derivada, ISF, dia a dia)', async ({ page }) => {
  await irAba(page, 'Extrato');
  await novoLancamento(page, { tipo: 'Entrada', valor: '2000,00', descricao: 'sobra' });
  await novoLancamento(page, { tipo: 'Saída', valor: '300,00', descricao: 'mercado' });
  // entrada FUTURA (salário): vira a próxima renda derivada, não conta no saldo atual
  await novoLancamento(page, { tipo: 'Entrada', valor: '4000,00', descricao: 'salário', data: await emDias(page, 30) });
  await expect(item(page, 'sobra')).toBeVisible();

  await irAba(page, 'Diário');
  // saldo atual = 2000 − 300 (o salário futuro não conta)
  await expect(page.locator('.destaque-hoje strong')).toHaveText('R$ 1.700,00');
  // próxima renda derivada → orçamento/dia calculado (não é mais "—") e ISF presente
  await expect(page.locator('.renda-linha')).toContainText('Próxima renda');
  await expect(page.locator('.indicadores strong').first()).not.toHaveText('—');
  await expect(page.locator('.isf strong')).not.toHaveText('—');
  // gráfico do saldo corrido + tabela dia a dia com o primeiro dia = hoje
  await expect(page.locator('svg.grafico')).toBeVisible();
  await expect(page.locator('.planilha tbody tr').first()).toContainText('Hoje');
  // horizonte inicial de 60 dias (61 linhas: 0..60) e o salário futuro aparece como recebido
  await expect(page.locator('.planilha tbody tr')).toHaveCount(61);
  await expect(page.locator('.planilha .c-num.entrada').first()).toContainText('+');

  // "Ver mais dias" estende o horizonte
  await page.getByRole('button', { name: 'Ver mais dias' }).click();
  await expect(page.locator('.planilha tbody tr')).toHaveCount(121);
});

test('carteiras são isoladas', async ({ page }) => {
  await irAba(page, 'Extrato');
  await novoLancamento(page, { tipo: 'Entrada', valor: '500,00', descricao: 'corrente-only' });

  // cria e foca numa nova carteira
  await page.locator('.carteira-switcher').click();
  await page.getByRole('button', { name: '+ Nova carteira' }).click();
  await sheet(page).getByPlaceholder('ex.: Corrente, Vale-alimentação…').fill('Vale');
  await sheet(page).getByRole('button', { name: 'Salvar' }).click();
  await expect(page.locator('.carteira-nome')).toHaveText('Vale');

  await irAba(page, 'Extrato');
  await expect(item(page, 'corrente-only')).toHaveCount(0);
  await irAba(page, 'Diário');
  await expect(page.locator('.destaque-hoje strong')).toHaveText('R$ 0,00'); // Vale vazia
});
