import { describe, expect, it } from "vitest";
import { parseToolError } from "../src/lib/toolError";

const explain = { properties: { run_id: { type: "string" }, detail: { type: "string", enum: ["brief", "full"] } }, required: ["run_id"] };

describe("parseToolError", () => {
  it("is null for anything that is not an error", () => {
    expect(parseToolError(JSON.stringify({ brief: "fine" }))).toBeNull();
    expect(parseToolError("[]")).toBeNull();
    expect(parseToolError("")).toBeNull();
    expect(parseToolError("just words")).toBeNull();
  });
  it("turns {error} into a sentence, names the missing field, and keeps the raw JSON", () => {
    const e = parseToolError(JSON.stringify({ error: "run_id is required" }), { run: "1l2y-rep4" })!;
    expect(e.message).toBe("run_id is required.");
    expect(e.hint).toBe("Add run_id to the input");
    expect(e.example).toBe('{"run_id": "1l2y-rep4"}');
    expect(e.raw).toContain('"error"');
  });
  it("fills the example from the run on screen and the schema's other required fields", () => {
    const e = parseToolError('{"error":"stage is required"}', { run: "3htb-jz4", schema: { properties: { run_id: { type: "string" }, stage: { type: "string" } }, required: ["run_id", "stage"] } })!;
    expect(e.example).toBe('{"run_id": "3htb-jz4", "stage": "product"}');
    expect(parseToolError('{"error":"run_b is required"}', { run: "1l2y-rep4" })!.example).toBe('{"run_b": "1l2y-rep4-ice1"}');
    expect(parseToolError('{"error":"run_b is required"}', { run: "3htb-jz4" })!.example).toBe('{"run_b": "1l2y-rep4"}');
  });
  it("capitalises a plain first word, leaves an identifier alone, adds one full stop", () => {
    const e = parseToolError('{"error":"no run \'x\' in the run index. Call list_runs for valid run ids."}')!;
    expect(e.message).toBe("No run 'x' in the run index. Call list_runs for valid run ids.");
    expect(e.hint).toBeNull(); expect(e.example).toBeNull();
    expect(parseToolError('{"error":"give discard_ps or start_frame, not both"}')!.message).toBe("Give discard_ps or start_frame, not both.");
  });
  it("hints a mistyped field with a value of that type, alongside the required fields", () => {
    const e = parseToolError('{"error":"include_session must be a boolean"}', { schema: { properties: { run_id: { type: "string" }, include_session: { type: "boolean" } }, required: ["run_id"] } })!;
    expect(e.hint).toBe("Give include_session as a boolean");
    expect(e.example).toBe('{"run_id": "1l2y-rep4", "include_session": true}');
    expect(parseToolError('{"error":"start_frame must be an integer"}')!.example).toBe('{"start_frame": 1}');
  });
  it("offers the first of an either-or pair", () => {
    const e = parseToolError('{"error":"run_id or mdin_text required"}', { run: "1l2y-rep4" })!;
    expect(e.hint).toBe("Add run_id or mdin_text to the input"); expect(e.example).toBe('{"run_id": "1l2y-rep4"}');
  });
  it("reads the console's own SyntaxError and shows a complete input for the tool", () => {
    const e = parseToolError("SyntaxError: Unexpected token } in JSON at position 1", { schema: explain, run: "1l2y-rep4" })!;
    expect(e.message).toBe("The input is not valid JSON (Unexpected token } in JSON at position 1).");
    expect(e.hint).toMatch(/double quotes/); expect(e.example).toBe('{"run_id": "1l2y-rep4"}');
    expect(parseToolError("Error: unknown tool x")!.message).toBe("Unknown tool x.");
  });
});
