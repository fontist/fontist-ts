export interface TextprotoField {
  name: string;
  /** Scalar value for `key: value` fields; null for message fields. */
  value: string | null;
  /** Parsed sub-message for `key { ... }` fields. */
  message: TextprotoMessage | null;
}

export interface TextprotoMessage {
  fields: TextprotoField[];
}

const SCALAR_LINE = /^([A-Za-z_][A-Za-z0-9_.]*)\s*:\s*(.*)$/;
const MESSAGE_LINE = /^([A-Za-z_][A-Za-z0-9_.]*)\s*\{$/;

/** Parses protobuf text format (the format of Google Fonts METADATA.pb
 * files): `key: "value"` scalars and `key { ... }` nested/repeated messages,
 * with `#` comments. Ruby uses the `unibuf` gem for this. */
export function parseTextproto(content: string): TextprotoMessage {
  const lines = content
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter((line) => line.length > 0);

  let index = 0;

  function parseMessage(depth: number): TextprotoMessage {
    const fields: TextprotoField[] = [];
    while (index < lines.length) {
      const line = lines[index]!;
      if (line === '}') {
        if (depth === 0) throw new Error('Unexpected closing brace in textproto');
        index += 1;
        return { fields };
      }
      const messageMatch = line.match(MESSAGE_LINE);
      if (messageMatch) {
        const name = messageMatch[1]!;
        index += 1;
        fields.push({ name, value: null, message: parseMessage(depth + 1) });
        continue;
      }
      const scalarMatch = line.match(SCALAR_LINE);
      if (scalarMatch) {
        const name = scalarMatch[1]!;
        const rawValue = scalarMatch[2]!;
        fields.push({ name, value: parseScalar(rawValue), message: null });
        index += 1;
        continue;
      }
      throw new Error(`Cannot parse textproto line: ${line}`);
    }
    if (depth !== 0) throw new Error('Unexpected end of textproto message');
    return { fields };
  }

  return parseMessage(0);
}

function parseScalar(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return trimmed;
}

/** Convenience lookups over a parsed message (mirrors the Ruby adapter's
 * field_value / find_fields helpers). */
export function fieldValue(message: TextprotoMessage, name: string): string | null {
  const field = message.fields.find((f) => f.name === name && f.message === null);
  return field?.value ?? null;
}

export function fieldBoolean(message: TextprotoMessage, name: string): boolean | null {
  const value = fieldValue(message, name);
  return value === null ? null : value === 'true';
}

export function fieldInteger(message: TextprotoMessage, name: string): number | null {
  const value = fieldValue(message, name);
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export function fieldFloat(message: TextprotoMessage, name: string): number | null {
  const value = fieldValue(message, name);
  if (value === null) return null;
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function findFields(message: TextprotoMessage, name: string): TextprotoField[] {
  return message.fields.filter((f) => f.name === name);
}
