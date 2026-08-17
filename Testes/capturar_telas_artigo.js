const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const outputDir = path.join(root, 'ArtigoTCC', 'figuras', 'interface');
const responsiveDir = path.join(root, 'ArtigoTCC', 'figuras', 'responsivo');
const files = [
  path.join(root, 'Testes', 'Sintéticas', 'sintetica_020_clara_parecida_scanner_1063mm.png'),
  path.join(root, 'Testes', 'Sintéticas', 'sintetica_001_clara_reta_1000mm.png'),
  path.join(root, 'Testes', 'Medidas de Scanner', 'Imagens Jean', 'Scanner Winrhizo - Continuo', '1Metro.bmp'),
];
const singleResponsiveFile = path.join(root, 'Testes', 'Sintéticas', 'sintetica_020_clara_parecida_scanner_1063mm.png');

async function screenshot(page, name, fullPage = false) {
  await page.screenshot({ path: path.join(outputDir, name), fullPage });
}

async function responsiveScreenshot(page, name, fullPage = false) {
  await page.screenshot({ path: path.join(responsiveDir, name), fullPage });
}

async function waitForNoLoading(page) {
  await page.waitForTimeout(500);
  await page.locator('.preview-local-loading, .workflow-lock-overlay').waitFor({ state: 'hidden', timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(500);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(responsiveDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath,
  });
  const context = await browser.newContext({
    viewport: { width: 1500, height: 1050 },
    deviceScaleFactor: 1,
  });
  await context.addInitScript(() => {
    window.PROCESSADOR_BACKEND_URL = 'http://127.0.0.1:8000/api';
  });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);

  await page.goto('http://127.0.0.1:4200/', { waitUntil: 'networkidle' });
  await screenshot(page, 'tela_01_selecao_claro.png');

  await page.getByRole('button', { name: 'Alternar tema' }).click();
  await page.waitForTimeout(400);
  await screenshot(page, 'tela_02_selecao_escuro.png');

  await page.getByRole('button', { name: 'Alternar tema' }).click();
  await page.waitForTimeout(400);
  await page.locator('input[type=file]').setInputFiles(files);
  await page.waitForTimeout(700);
  await screenshot(page, 'tela_03_lista_lote.png');

  await page.getByRole('button', { name: 'Analisar prévia' }).click();
  await waitForNoLoading(page);
  await page.locator('#manualDpi').fill('300');
  await page.waitForTimeout(700);
  await screenshot(page, 'tela_04_previa_limiar.png');

  await page.getByRole('button', { name: 'Imagem 2:', exact: false }).click();
  await waitForNoLoading(page);
  await screenshot(page, 'tela_05_previa_lote.png');

  await page.getByRole('button', { name: 'Recortar imagem carregada' }).click();
  await page.waitForTimeout(700);
  await screenshot(page, 'tela_06_modal_recorte.png');
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await page.waitForTimeout(500);

  const processButton = page.getByRole('button', { name: 'Processar imagens' });
  await processButton.click();
  await page.waitForSelector('.workflow-lock-overlay', { state: 'visible', timeout: 10000 }).catch(() => {});
  await screenshot(page, 'tela_07_processamento_lote.png');
  await waitForNoLoading(page);
  await page.waitForSelector('app-results-step', { timeout: 180000 });
  await screenshot(page, 'tela_08_resultados_lote.png', true);

  await page.getByRole('button', { name: 'Resultado 3:', exact: false }).click();
  await page.waitForTimeout(700);
  await screenshot(page, 'tela_09_resultados_scanner.png', true);

  await context.close();

  await captureResponsive(browser, {
    prefix: 'mobile',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
  });

  await captureResponsive(browser, {
    prefix: 'ipad',
    viewport: { width: 820, height: 1180 },
    deviceScaleFactor: 2,
    isMobile: true,
  });

  await browser.close();
}

async function captureResponsive(browser, profile) {
  const context = await browser.newContext({
    viewport: profile.viewport,
    deviceScaleFactor: profile.deviceScaleFactor,
    isMobile: profile.isMobile,
  });
  await context.addInitScript(() => {
    window.PROCESSADOR_BACKEND_URL = 'http://127.0.0.1:8000/api';
  });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);

  await page.goto('http://127.0.0.1:4200/', { waitUntil: 'networkidle' });
  await responsiveScreenshot(page, `${profile.prefix}_01_selecao.png`, true);

  await page.locator('input[type=file]').setInputFiles([singleResponsiveFile]);
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Analisar prévia' }).click();
  await waitForNoLoading(page);
  await page.locator('#manualDpi').fill('300');
  await page.waitForTimeout(600);
  await responsiveScreenshot(page, `${profile.prefix}_02_previa.png`, true);

  await page.getByRole('button', { name: 'Processar', exact: true }).click();
  await waitForNoLoading(page);
  await page.waitForSelector('app-results-step', { timeout: 180000 });
  await responsiveScreenshot(page, `${profile.prefix}_03_resultados.png`, true);

  await context.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
