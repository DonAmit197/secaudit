const { Command } = require('commander');
const init = require('./commands/init');
const scan = require('./commands/scan');
const compare = require('./commands/compare');
const list = require('./commands/list');
const doctor = require('./commands/doctor');

function run(argv) {
  const program = new Command();
  const cwd = process.cwd();

  program.name('secaudit').description('Dependency security audit CLI (npm audit + retire.js + cve-lite-cli)');

  program
    .command('init')
    .description('Set up the audits/ folder and check that the scanners are installed')
    .action(async () => {
      await init(cwd);
    });

  program
    .command('scan')
    .description('Run npm audit, retire.js, and cve-lite-cli against the current project')
    .option('--label <name>', 'label for this checkpoint (defaults to release-<package.json version>)')
    .option('--no-open', 'do not auto-open the generated HTML reports')
    .action(async (opts) => {
      await scan(cwd, { label: opts.label, open: opts.open });
    });

  program
    .command('compare')
    .description('Compare two checkpoints and write a Markdown diff report')
    .argument('[label1]', 'the "before" checkpoint label')
    .argument('[label2]', 'the "after" checkpoint label')
    .option('--before-timestamp <iso>', 'pick an older checkpoint for label1 explicitly')
    .action(async (label1, label2, opts) => {
      await compare(cwd, label1, label2, { beforeTimestamp: opts.beforeTimestamp });
    });

  program
    .command('doctor')
    .description('Check your machine for anything that stops the scanners from installing or running')
    .action(async () => {
      await doctor(cwd);
    });

  program
    .command('list')
    .description('List every checkpoint on disk')
    .action(async () => {
      await list(cwd);
    });

  program.parseAsync(argv);
}

module.exports = run;
