const UNZONED_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UNZONED_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?$/;

/** Collapse control whitespace so display metadata cannot break Markdown/XML structure. */
function sanitizeDisplayText(value: string): string {
  let result = "";
  let pendingSpace = false;

  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) {
      pendingSpace = result.length > 0;
      continue;
    }
    if (pendingSpace) {
      result += " ";
      pendingSpace = false;
    }
    result += character;
  }

  return result.trim();
}

/**
 * Format a memory creation timestamp as a UTC `YYYY-MM-DD` calendar date.
 * Numeric values are treated as epoch milliseconds. ISO strings without a
 * timezone offset are interpreted as UTC (not local), matching safeToISOString
 * callers that already emit Z-suffixed values.
 */
export function formatMemoryCreatedDate(value: unknown): string | null {
  let date: Date;

  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    date = new Date(value);
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (!Number.isFinite(numeric)) return null;
      date = new Date(numeric);
    } else if (UNZONED_DATE_RE.test(trimmed)) {
      date = new Date(`${trimmed}T00:00:00.000Z`);
    } else if (UNZONED_DATETIME_RE.test(trimmed)) {
      date = new Date(`${trimmed}Z`);
    } else {
      date = new Date(trimmed);
    }
  } else {
    return null;
  }

  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function escapeXmlAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&apos;";
      default:
        return character;
    }
  });
}

type MemoryProvenance = {
  id?: unknown;
  createdAt?: unknown;
  projectName?: unknown;
};

export function buildMemoryProvenanceAttributes(mem: MemoryProvenance): string {
  const attributes: string[] = [];

  if (typeof mem.id === "string") {
    const id = sanitizeDisplayText(mem.id);
    if (id) attributes.push(`id="${escapeXmlAttribute(id)}"`);
  }

  const created = formatMemoryCreatedDate(mem.createdAt);
  if (created) attributes.push(`created="${created}"`);

  if (typeof mem.projectName === "string") {
    const projectName = sanitizeDisplayText(mem.projectName);
    if (projectName) attributes.push(`project="${escapeXmlAttribute(projectName)}"`);
  }

  return attributes.length > 0 ? ` ${attributes.join(" ")}` : "";
}

export function buildMemoryProvenanceSuffix(mem: MemoryProvenance): string {
  const parts: string[] = [];

  if (typeof mem.id === "string") {
    const id = sanitizeDisplayText(mem.id);
    if (id) parts.push(id);
  }

  const created = formatMemoryCreatedDate(mem.createdAt);
  if (created) parts.push(`created ${created}`);

  if (typeof mem.projectName === "string") {
    const projectName = sanitizeDisplayText(mem.projectName);
    if (projectName) parts.push(projectName);
  }

  return parts.length > 0 ? ` (${parts.join(" · ")})` : "";
}
