// Local review notes use the host's atomic compare-and-swap file writes.
export function parseNotes(raw) {
  if (!raw) return [];
  const data = JSON.parse(raw);
  if (data.version !== 1 || !Array.isArray(data.notes)) throw new Error("Unsupported AI notes file");
  return data.notes;
}

export async function changeNotes(io, path, change) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await io.read(path), notes = parseNotes(raw);
    const targets = change.before || [];
    for (const target of targets) {
      if (JSON.stringify(notes.find(note => note.id === target.id)) !== JSON.stringify(target)) throw new Error("This note changed in another window. Refresh notes before editing it.");
    }
    const ids = new Set(targets.map(note => note.id));
    const next = notes.filter(note => !ids.has(note.id));
    if (change.note) {
      if (next.some(note => note.id === change.note.id)) throw new Error("This note already exists. Refresh notes.");
      next.push(change.note);
    }
    try { await io.write(path, JSON.stringify({ version: 1, notes: next }), raw); return next; }
    catch (error) { if (attempt === 2) throw error; }
  }
}

export function noteQuote(rows, start, end) {
  return rows.filter(row => row.next >= start && row.next <= end).map(row => row.text.slice(1)).join("\n");
}

export function formatNotes(notes) {
  return notes.map(note => [
    `${note.path}:${note.start === note.end ? note.end : `${note.start}-${note.end}`} (${note.layer})`,
    note.quote ? `Selected code:\n${note.quote}` : "", `Note:\n${note.body}`,
  ].filter(Boolean).join("\n\n")).join("\n\n---\n\n");
}
