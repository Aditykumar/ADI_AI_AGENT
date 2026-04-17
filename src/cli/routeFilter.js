'use strict';
/**
 * Route Filter — interactive terminal UI.
 *
 * Shows discovered routes grouped by category (Pages / API),
 * lets user search/filter, then pick specific routes via checkboxes.
 *
 * Returns { selectedPages, selectedApiRoutes }
 */
const inquirer = require('inquirer');
const chalk    = require('chalk');

/**
 * Interactive route selector.
 * @param {object} discovery  - output from routeDiscovery.discoverRoutes()
 * @returns {Promise<{ selectedPages: object[], selectedApiRoutes: object[] }>}
 */
async function selectRoutes(discovery) {
  const { pages, api_routes, base } = discovery;

  printBanner(discovery);

  // ── Step 1: Quick mode select ────────────────────────────────────────
  const { mode } = await inquirer.prompt([{
    type:    'list',
    name:    'mode',
    message: 'How do you want to select routes?',
    choices: [
      { name: `✅  All routes                 (${pages.length} pages + ${api_routes.length} API)`, value: 'all'        },
      { name: '🔍  Filter by pattern           (type a path prefix e.g. /api, /admin)',             value: 'pattern'    },
      { name: '☑️   Pick individually           (checkbox list)',                                   value: 'pick'       },
      { name: '📄  Pages only                  (skip API routes)',                                  value: 'pages_only' },
      { name: '🔌  API routes only             (skip UI pages)',                                    value: 'api_only'   },
    ],
    pageSize: 8,
  }]);

  if (mode === 'all') {
    printSelection(pages, api_routes);
    return { selectedPages: pages, selectedApiRoutes: api_routes };
  }

  if (mode === 'pages_only') {
    printSelection(pages, []);
    return { selectedPages: pages, selectedApiRoutes: [] };
  }

  if (mode === 'api_only') {
    printSelection([], api_routes);
    return { selectedPages: [], selectedApiRoutes: api_routes };
  }

  // ── Step 2: Pattern filter ──────────────────────────────────────────
  let filteredPages  = [...pages];
  let filteredApi    = [...api_routes];

  if (mode === 'pattern') {
    const { pattern } = await inquirer.prompt([{
      type:    'input',
      name:    'pattern',
      message: 'Filter pattern (e.g. /api, /admin, /user — comma-separate multiple):',
      validate: v => v.trim().length > 0 || 'Enter at least one pattern',
    }]);

    const patterns = pattern.split(',').map(p => p.trim().toLowerCase()).filter(Boolean);

    filteredPages = pages.filter(p =>
      patterns.some(pat => p.path.toLowerCase().includes(pat))
    );
    filteredApi = api_routes.filter(a =>
      patterns.some(pat => a.path.toLowerCase().includes(pat))
    );

    console.log(chalk.gray(
      `  Pattern matched: ${filteredPages.length} pages, ${filteredApi.length} API routes\n`
    ));

    if (filteredPages.length === 0 && filteredApi.length === 0) {
      console.log(chalk.yellow('  No routes matched. Falling back to all routes.'));
      filteredPages = pages;
      filteredApi   = api_routes;
    }
  }

  // ── Step 3: Checkbox individual pick ───────────────────────────────
  // Build choices with separators
  const choices = [];

  if (filteredPages.length > 0) {
    choices.push(new inquirer.Separator(chalk.cyan('─── 📄 Pages ──────────────────────────────────')));
    for (const p of filteredPages) {
      const label = buildPageLabel(p);
      choices.push({ name: label, value: { _type: 'page', ...p }, checked: true, short: p.path });
    }
  }

  if (filteredApi.length > 0) {
    choices.push(new inquirer.Separator(chalk.cyan('─── 🔌 API Routes ─────────────────────────────')));
    for (const a of filteredApi) {
      const label = buildApiLabel(a);
      choices.push({ name: label, value: { _type: 'api', ...a }, checked: true, short: `${a.method} ${a.path}` });
    }
  }

  if (choices.filter(c => !(c instanceof inquirer.Separator)).length === 0) {
    console.log(chalk.yellow('  No routes available to select.'));
    return { selectedPages: [], selectedApiRoutes: [] };
  }

  console.log(chalk.gray('\n  Space = toggle  |  a = all  |  i = invert  |  Enter = confirm\n'));

  const { selected } = await inquirer.prompt([{
    type:     'checkbox',
    name:     'selected',
    message:  'Select routes to test:',
    choices,
    pageSize: 20,
    validate: v => v.length > 0 || 'Select at least one route',
  }]);

  const selectedPages     = selected.filter(s => s._type === 'page').map(({ _type, ...r }) => r);
  const selectedApiRoutes = selected.filter(s => s._type === 'api').map(({ _type, ...r }) => r);

  printSelection(selectedPages, selectedApiRoutes);
  return { selectedPages, selectedApiRoutes };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function printBanner(discovery) {
  const { pages, api_routes, base, stats } = discovery;
  console.log('\n' + chalk.bold.cyan('╔══════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║   🗺  Route Discovery Complete                            ║'));
  console.log(chalk.bold.cyan('╚══════════════════════════════════════════════════════════╝'));
  console.log(chalk.gray(`  Site     : ${base}`));
  console.log(chalk.gray(`  Pages    : ${chalk.white.bold(pages.length)} discovered`));
  console.log(chalk.gray(`  API      : ${chalk.white.bold(api_routes.length)} routes intercepted`));
  console.log(chalk.gray(`  Crawled  : ${stats.crawled} pages  |  Skipped: ${stats.skipped}`));
  console.log('');
}

function printSelection(pages, apiRoutes) {
  console.log('\n' + chalk.bold.green('  Selected for testing:'));
  console.log(chalk.green(`    Pages     : ${pages.length}`));
  console.log(chalk.green(`    API routes: ${apiRoutes.length}`));

  if (pages.length > 0) {
    console.log(chalk.gray('\n  Pages:'));
    pages.slice(0, 10).forEach(p => console.log(chalk.gray(`    ${statusDot(p.status)} ${p.path}`)));
    if (pages.length > 10) console.log(chalk.gray(`    … and ${pages.length - 10} more`));
  }
  if (apiRoutes.length > 0) {
    console.log(chalk.gray('\n  API routes:'));
    apiRoutes.slice(0, 10).forEach(a => console.log(chalk.gray(`    ${methodColor(a.method)} ${a.path}`)));
    if (apiRoutes.length > 10) console.log(chalk.gray(`    … and ${apiRoutes.length - 10} more`));
  }
  console.log('');
}

function buildPageLabel(p) {
  const status = p.status > 0 ? statusDot(p.status) : '○';
  const source = p.source === 'sitemap' ? chalk.gray('[sitemap]') : '';
  const title  = p.title ? chalk.gray(` — ${p.title.substring(0, 40)}`) : '';
  return `${status} ${chalk.white(p.path)}${title} ${source}`;
}

function buildApiLabel(a) {
  return `${methodColor(a.method)} ${chalk.white(a.path)}  ${chalk.gray('[' + a.source + ']')}`;
}

function statusDot(status) {
  if (status >= 200 && status < 300) return chalk.green('●');
  if (status >= 300 && status < 400) return chalk.yellow('●');
  if (status >= 400)                  return chalk.red('●');
  return chalk.gray('○');
}

function methodColor(method) {
  const colors = { GET: chalk.green, POST: chalk.blue, PUT: chalk.yellow,
                   PATCH: chalk.cyan, DELETE: chalk.red };
  const fn = colors[method] || chalk.white;
  return fn(method.padEnd(6));
}

module.exports = { selectRoutes };
