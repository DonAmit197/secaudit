const readline = require('node:readline');

// One shared interface for the whole command. Creating a new interface per
// question drops buffered lines when answers are piped in (CI, scripts):
// lines that arrive before a question is asked are queued here instead.
let rl = null;
let closed = false;
let pendingResolve = null;
const queuedLines = [];

function ensureInterface() {
  if (rl || closed) return;
  rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on('line', (text) => queuedLines.push(text));
  rl.on('close', () => {
    closed = true;
    rl = null;
    // stdin ended (e.g. piped input ran out): an open question gets its default.
    if (pendingResolve) {
      process.stdout.write('\n');
      pendingResolve(null);
      pendingResolve = null;
    }
  });
}

function ask(question) {
  ensureInterface();
  if (queuedLines.length) {
    const text = queuedLines.shift();
    process.stdout.write(`${question}${text}\n`);
    return Promise.resolve(text);
  }
  if (closed) {
    process.stdout.write(`${question}\n`);
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    pendingResolve = resolve;
    rl.question(question, (text) => {
      pendingResolve = null;
      // A terminal echoes what the user typed; piped input doesn't.
      if (!process.stdin.isTTY) process.stdout.write(`${text}\n`);
      resolve(text);
    });
  });
}

async function confirm(question, defaultYes = true) {
  const suffix = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = await ask(`${question} ${suffix} `);
  if (answer === null) return defaultYes;
  const normalized = answer.trim().toLowerCase();
  if (!normalized) return defaultYes;
  return normalized === 'y' || normalized === 'yes';
}

// Call once a command has finished asking, or the open stdin keeps the
// process alive.
function closePrompts() {
  if (rl) rl.close();
}

module.exports = { confirm, closePrompts };
