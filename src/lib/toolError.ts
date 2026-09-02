// What a failed tool call looks like to a person. callTool answers {"error": "..."} as JSON, and the console's own
// JSON.parse of the input box throws a SyntaxError; both reach the Sidebar as one string and come through here.
// Pure: the Sidebar renders the result as a red callout. Null means the output was not an error.
export interface ToolError {
  /** the message as a sentence: capital first letter unless the first word is an identifier, one full stop at the end */
  message: string;
  /** one line saying what to change, when the message names a missing or mistyped field; null when it does not */
  hint: string | null;
  /** an input that would satisfy the hint, as JSON, for the hint to show in mono; null without a hint */
  example: string | null;
  /** the raw output, pretty-printed when it parses */
  raw: string;
}
interface Prop { type?: string; enum?: unknown[] }
interface Schema { properties?: Record<string, Prop>; required?: string[] }
export interface ToolErrorContext {
  /** the run on screen; examples name it so they can be pasted as they are */
  run?: string;
  /** the tool's inputSchema; its required fields fill the example so the whole input works, not just the one field */
  schema?: object;
}

const FIRST_RUN = "1l2y-rep4"; // the run every example falls back to; its replicate is the second run of a pair
const REPLICATE = "1l2y-rep4-ice1";

export function parseToolError(raw: string, ctx: ToolErrorContext = {}): ToolError | null {
  const text = raw.trim();
  if (!text) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = undefined; }
  if (parsed !== undefined) {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || typeof (parsed as any).error !== "string") return null;
    const msg = String((parsed as any).error);
    const h = hintFor(msg, ctx);
    return { message: sentence(msg), hint: h?.hint ?? null, example: h?.example ?? null, raw: JSON.stringify(parsed, null, 1) };
  }
  // Not JSON: the console's JSON.parse threw, or callTool itself threw (String(e) starts with the error's name).
  const named = /^(\w*Error)\b:?\s*(.*)$/s.exec(text);
  if (!named) return null;
  const [, kind, detail] = named;
  if (kind === "SyntaxError") {
    return { message: sentence(detail ? `The input is not valid JSON (${detail.replace(/\.$/, "")})` : "The input is not valid JSON"),
      hint: "The input box must hold one JSON object: keys in double quotes, no trailing comma", example: exampleJson(exampleInput(ctx, [])), raw: text };
  }
  return { message: sentence(detail || kind), hint: null, example: null, raw: text };
}

/** First letter up when the first word is a plain word (not run_id, not a path), one full stop at the end. */
function sentence(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (!t) return "Unknown error.";
  const first = t.split(" ")[0];
  const cap = /^[a-z]+$/.test(first) ? t[0].toUpperCase() + t.slice(1) : t;
  return /[.!?]$/.test(cap) ? cap : `${cap}.`;
}

/** The three shapes the tools throw for input problems: "x is required", "x or y required", "x must be a <type>". */
function hintFor(msg: string, ctx: ToolErrorContext): { hint: string; example: string } | null {
  const m = msg.trim();
  let r: RegExpExecArray | null;
  if ((r = /^(\w+) is required$/.exec(m))) return { hint: `Add ${r[1]} to the input`, example: exampleJson(exampleInput(ctx, [r[1]])) };
  if ((r = /^(\w+) or (\w+) required$/.exec(m))) return { hint: `Add ${r[1]} or ${r[2]} to the input`, example: exampleJson(exampleInput(ctx, [r[1]])) };
  if ((r = /^(\w+) must be an? (\w+)/.exec(m))) return { hint: `Give ${r[1]} as a ${r[2]}`, example: exampleJson(exampleInput(ctx, [r[1]], r[2])) };
  return null;
}

/** The schema's required fields in order, plus the named ones, each with a value of the right shape. */
function exampleInput(ctx: ToolErrorContext, fields: string[], type?: string): Record<string, unknown> {
  const schema = (ctx.schema ?? {}) as Schema;
  const props = schema.properties ?? {};
  const keys = [...new Set([...(schema.required ?? []), ...fields])];
  return Object.fromEntries(keys.map(k => [k, exampleValue(k, props[k], ctx.run, fields.includes(k) ? type : undefined)]));
}

function exampleValue(field: string, prop: Prop | undefined, run: string | undefined, type?: string): unknown {
  if (field === "run_id" || field === "run_a") return run || FIRST_RUN;
  if (field === "run_b") return run && run !== FIRST_RUN ? FIRST_RUN : REPLICATE;
  if (field === "stage") return "product";
  if (prop?.enum?.length) return prop.enum[0];
  switch (type ?? prop?.type) {
    case "boolean": return true;
    case "number": case "integer": return 1;
    case "object": return {};
    case "array": return [];
    default: return `<${field}>`;
  }
}

/** {"run_id": "1l2y-rep4", "stage": "product"} — one line, a space after each colon and comma, as a person would type it. */
function exampleJson(obj: Record<string, unknown>): string {
  return `{${Object.entries(obj).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", ")}}`;
}
