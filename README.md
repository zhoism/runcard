# runcard

A shareable, validated record of a molecular-dynamics simulation — a page a
collaborator can open, inspect, compare, and hand to their agent.

Built for the OpenAI WebMCP Challenge (Aug 25 – Sep 3, 2026). The page registers
WebMCP tools (`document.modelContext.registerTool`) so an agent in ChatGPT's
built-in browser or Chrome (`chrome://flags/#enable-webmcp-testing`) can read the
run's manifest, validate every stage against AMBER physics rules, compare runs,
explain uncertainty, and propose bounded, human-approved changes.

## Develop

```
bun install
bun run dev
bun run test      # validator port vs. the Python oracle (test/oracle/expected.json)
```

The AMBER `.in` validator (`src/lib/amberCheck.ts`) is a port of
`check_amber.py` from the author's internship pipeline. `test/corpus/` holds
553 input files (real pipeline stages + targeted mutants); `test/oracle/dump.py`
regenerates the expected findings from the original Python.

## License

MIT
