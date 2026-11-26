// Shared sidebar scope: null means All; { machine: null } means Local.
export const SCOPE_KEY = "offbit.machine-scope";

export function machineNames(spaces, machines) {
  const temporary = new Set(machines.filter(machine => machine.temporary).map(machine => machine.name));
  const remote = [...spaces.map(space => space.machine), ...machines.map(machine => machine.name)]
    .filter(name => typeof name === "string" && name.length && !temporary.has(name));
  return [null, ...new Set(remote)].sort((a, b) => a === null ? -1 : b === null ? 1 : a.localeCompare(b));
}

export function selectedMachine(scope, names) {
  return scope && names.includes(scope.machine) ? scope.machine : undefined;
}

export function cycleScope(scope, names, direction) {
  const choices = [undefined, ...names];
  const index = choices.indexOf(selectedMachine(scope, names));
  const machine = choices[(index + direction + choices.length) % choices.length];
  return machine === undefined ? null : { machine };
}

export function machineLabel(machine) {
  return machine === undefined ? "All" : machine ?? "Local";
}

// Preserve one switch per touchpad gesture; vertical scrolling is ignored.
export function swipeDirection(swipe, event, now) {
  const delta = event.delta_lines ?? event.delta;
  const x = delta.x, y = delta.y;
  if (event.touch_phase === "cancelled") {
    Object.assign(swipe, { acc: 0, at: now, switched: true });
    return 0;
  }
  if (event.touch_phase === "started" || now - swipe.at > 250 || (x && Math.sign(x) !== swipe.direction)) {
    Object.assign(swipe, { acc: 0, direction: Math.sign(x), switched: false });
  }
  swipe.at = now;
  if (!x || Math.abs(x) <= Math.abs(y) * 1.25) { swipe.acc = 0; return 0; }
  if (event.delta_lines) return x < 0 ? 1 : -1;
  if (swipe.switched) return 0;
  swipe.acc += x;
  if (Math.abs(swipe.acc) < 24) return 0;
  swipe.switched = true;
  return x < 0 ? 1 : -1;
}
