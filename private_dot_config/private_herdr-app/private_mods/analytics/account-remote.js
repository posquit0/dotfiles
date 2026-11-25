// Only source code travels to the remote core. Its credentials never leave it.
export const ACCOUNT_NODE_LAUNCHER = 'cd "$HOME" && if [ -x "$HOME/.local/share/mise/shims/node" ]; then exec "$HOME/.local/share/mise/shims/node" "$@"; else exec node "$@"; fi';

export function remoteAccountScript(source) {
  return `${source}\n
const [major, minor] = process.versions.node.split(".").map(Number);
const result = major < 22 || (major === 22 && minor < 15)
  ? { version: 1, entries: [{ provider: "Accounts", status: "error", message: "Node 22.15 or newer is required on this machine." }] }
  : await collectAccounts({ localOnly: false });
process.stdout.write(JSON.stringify(result) + "\\n");
`;
}
