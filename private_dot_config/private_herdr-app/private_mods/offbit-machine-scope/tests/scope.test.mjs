import test from "node:test";
import assert from "node:assert/strict";
import { machineNames, selectedMachine, cycleScope, machineLabel, swipeDirection } from "../scope.js";

test("cycle All → Local → sorted remotes → All in both directions", () => {
  const names = machineNames([{ machine: "remote-b" }, { machine: null }], [{ name: "remote-a" }, { name: "remote-b" }]);
  assert.deepEqual(names, [null, "remote-a", "remote-b"]);
  let scope = null;
  for (const expected of [null, "remote-a", "remote-b", undefined]) {
    scope = cycleScope(scope, names, 1);
    assert.equal(selectedMachine(scope, names), expected);
  }
  for (const expected of ["remote-b", "remote-a", null, undefined]) {
    scope = cycleScope(scope, names, -1);
    assert.equal(selectedMachine(scope, names), expected);
  }
});

test("local-only cycles, disconnected remotes remain, temporary machines are excluded", () => {
  assert.deepEqual(machineNames([], []), [null]);
  assert.deepEqual(cycleScope(null, [null], 1), { machine: null });
  assert.equal(cycleScope({ machine: null }, [null], 1), null);
  assert.deepEqual(machineNames([{ machine: "sandbox" }], [
    { name: "offline", layout: "unavailable" }, { name: "sandbox", temporary: true },
  ]), [null, "offline"]);
});

test("All and Local do not collide with remote names, removed selections fall back", () => {
  const names = [null, "All", "Local"];
  assert.equal(selectedMachine(null, names), undefined);
  assert.equal(selectedMachine({ machine: null }, names), null);
  assert.equal(selectedMachine({ machine: "All" }, names), "All");
  assert.equal(selectedMachine({ machine: "removed" }, names), undefined);
  assert.deepEqual(cycleScope({ machine: "removed" }, names, 1), { machine: null });
  assert.equal(machineLabel(undefined), "All");
  assert.equal(machineLabel(null), "Local");
});

test("a swipe crosses its threshold once and ignores momentum", () => {
  const swipe = { acc: 0, at: 0, direction: 0, switched: false };
  const move = (x, time, phase) => swipeDirection(swipe, { delta: { x, y: 0 }, touch_phase: phase }, time);
  assert.equal(move(-12, 1000, "started"), 0);
  assert.equal(move(-13, 1016, "moved"), 1);
  assert.equal(move(-40, 1032, "moved"), 0);
  assert.equal(move(-40, 1048, "ended"), 0);
  assert.equal(move(30, 1100, "started"), -1);
});

test("vertical, diagonal and cancelled gestures do not switch; mouse wheel can", () => {
  const swipe = { acc: 0, at: 0, direction: 0, switched: false };
  for (const event of [
    { delta: { x: 0, y: -90 } },
    { delta: { x: 20, y: 30 } },
    { delta: { x: -90, y: 0 }, touch_phase: "cancelled" },
  ]) assert.equal(swipeDirection(swipe, event, 1000), 0);
  assert.equal(swipeDirection(swipe, { delta_lines: { x: -1, y: 0 } }, 2000), 1);
  assert.equal(swipeDirection(swipe, { delta_lines: { x: 1, y: 0 } }, 2100), -1);
});
