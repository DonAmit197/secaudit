// Small terminal helpers for checklist-style output (✓ / ✗ / ! / ○) and a
// spinner for slow steps. No dependencies: plain ANSI codes, switched off
// when output isn't a terminal or NO_COLOR is set.

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

function paint(code) {
  return (text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : String(text));
}

const color = {
  green: paint(32),
  red: paint(31),
  yellow: paint(33),
  cyan: paint(36),
  dim: paint(2),
  bold: paint(1),
};

// Single-width glyphs only: ✔ ✖ ⚠ ℹ render as double-width emoji in
// Windows Terminal and swallow the space after them.
const symbol = {
  ok: color.green('✓'),
  fail: color.red('✗'),
  warn: color.yellow('!'),
  skip: color.dim('○'),
  info: color.cyan('i'),
};

const INDENT = '  ';

function line(sym, text) {
  console.log(`${INDENT}${sym} ${text}`);
}

const ok = (text) => line(symbol.ok, text);
const fail = (text) => line(symbol.fail, text);
const warn = (text) => line(symbol.warn, text);
const skip = (text) => line(symbol.skip, text);
const info = (text) => line(symbol.info, text);

// Indented follow-up lines under a checklist item (reasons, fixes, paths).
function detail(text, depth = 2) {
  const pad = INDENT.repeat(depth);
  for (const l of String(text).split('\n')) console.log(`${pad}${l}`);
}

function heading(text) {
  console.log(`\n${color.bold(text)}`);
}

// Pads a label so the second column of a checklist lines up.
function col(text, width = 16) {
  return String(text).padEnd(width);
}

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// Returns an object whose methods replace the spinner line with a final
// checklist line. Without a TTY it prints nothing until it finishes.
function spinner(text) {
  const animated = Boolean(process.stdout.isTTY);
  let frame = 0;
  let timer = null;

  if (animated) {
    process.stdout.write(`${INDENT}${color.cyan(FRAMES[0])} ${text}`);
    timer = setInterval(() => {
      frame = (frame + 1) % FRAMES.length;
      process.stdout.write(`\r${INDENT}${color.cyan(FRAMES[frame])} ${text}`);
    }, 80);
  }

  function finish(sym, finalText) {
    if (timer) clearInterval(timer);
    if (animated) process.stdout.write('\r\x1b[2K');
    line(sym, finalText ?? text);
  }

  return {
    succeed: (t) => finish(symbol.ok, t),
    fail: (t) => finish(symbol.fail, t),
    warn: (t) => finish(symbol.warn, t),
    skip: (t) => finish(symbol.skip, t),
  };
}

module.exports = { color, symbol, ok, fail, warn, skip, info, detail, heading, col, spinner };
