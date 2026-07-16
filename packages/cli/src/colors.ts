const enabled = process.stdout.isTTY === true && !process.env.NO_COLOR;

function wrap(code: string) {
  return (s: string): string => (enabled ? `\x1b[${code}m${s}\x1b[0m` : s);
}

export const c = {
  dim: wrap("2"),
  bold: wrap("1"),
  red: wrap("31"),
  green: wrap("32"),
  yellow: wrap("33"),
  cyan: wrap("36"),
  magenta: wrap("35"),
};
