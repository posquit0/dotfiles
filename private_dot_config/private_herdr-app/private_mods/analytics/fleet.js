// Live Herdr metadata is deliberately not joined to historic session IDs:
// terminal addresses and transcript session IDs are different identities.
export function fleetSnapshot(agents, terminals, spaces, machines = [], scope = null, machine = undefined) {
  const byAddress = new Map(terminals.map((terminal) => [terminal.address, terminal]));
  const bySpace = new Map(spaces.map((space) => [space.id, space]));
  const allAgents = new Map(agents.map((agent) => [agent.address, agent]));
  // Herdr's agents() contains pane agents. Unkept child agents live only in
  // terminals(); inherit the nearest known ancestor's space, without cycles.
  for (const terminal of terminals) {
    if (allAgents.has(terminal.address) || terminal.state !== "live" || !terminal.parent) continue;
    if (!terminal.program?.agent && !["working", "blocked", "idle", "done", "error"].includes(terminal.status)) continue;
    const visited = new Set([terminal.address]);
    let address = terminal.parent;
    let ancestor;
    while (address && !visited.has(address)) {
      visited.add(address);
      ancestor = allAgents.get(address);
      if (ancestor) break;
      address = byAddress.get(address)?.parent;
    }
    if (!ancestor) continue;
    allAgents.set(terminal.address, {
      ...ancestor, address: terminal.address,
      title: terminal.name || terminal.template || terminal.program?.name || terminal.address,
      app: terminal.report?.app || terminal.program?.name || null,
      program: terminal.program,
      status: terminal.status === "error" ? "blocked" : terminal.status === "done" ? "idle" : terminal.status,
    });
  }
  const unique = new Map([...allAgents].filter(([, agent]) => (!scope || agent.space === scope)
    && (machine === undefined || (bySpace.get(agent.space)?.machine ?? null) === machine)));
  const counts = { working: 0, blocked: 0, done: 0, idle: 0, unknown: 0 };
  const rows = [...unique.values()].map((agent) => {
    const state = Object.hasOwn(counts, agent.status) ? agent.status : "unknown";
    counts[state]++;
    const parent = byAddress.get(agent.address)?.parent ?? null;
    return {
      address: agent.address, status: state, parent,
      name: agent.title || agent.tab_name || agent.address,
      app: agent.program?.name || agent.app || "Agent",
      program: agent.program ?? null,
      space: agent.space_name || bySpace.get(agent.space)?.name || "Unknown space",
      machine: bySpace.get(agent.space)?.machine ?? null,
      parentName: parent ? unique.get(parent)?.title || parent : null,
      children: 0,
    };
  });
  const mapped = new Map(rows.map((row) => [row.address, row]));
  for (const row of rows) if (mapped.has(row.parent)) mapped.get(row.parent).children++;
  const order = { blocked: 0, done: 1, working: 2, idle: 3, unknown: 4 };
  rows.sort((a, b) => order[a.status] - order[b.status] || a.space.localeCompare(b.space) || a.name.localeCompare(b.name));
  return { counts, rows, total: rows.length, unavailable: machines.filter((machine) => machine.layout !== "ready") };
}
