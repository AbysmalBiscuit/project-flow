import { strict as assert } from "node:assert";

const root = "/home/lev/git/github/AbysmalBiscuit/project-flow_workspaces/846-perf-overview-send-overview-cards-without";
const children: ReturnType<typeof Bun.spawn>[] = [];

async function start(checkout: string) {
  const child = Bun.spawn([
    "bun", "run", `${root}/.devkit/proof/measure-overview.ts`, checkout,
    "/tmp/claude-846-proof/store.bak", "/tmp/claude-846-proof/config/project-flow/config.json", "1",
  ], { env: { ...process.env, HOLD: "1" }, stdout: "pipe", stderr: "pipe" });
  children.push(child);
  const reader = child.stdout.getReader();
  let output = "";
  while (true) {
    const { value, done } = await reader.read();
    output += new TextDecoder().decode(value);
    const address = output.match(/serving (http:\/\/[^\s]+)/)?.[1];
    if (address) return address;
    if (done) throw new Error(`server stopped: ${output} ${await new Response(child.stderr).text()}`);
  }
}

try {
  const before = await start("/tmp/claude-846-main");
  const after = await start(root);
  const overview = await (await fetch(new URL("/api/overview", after))).json() as {
    projects: { name: string }[];
  };
  let compared = 0;
  async function compare(path: string, expectedStatus = 200) {
    const responses = await Promise.all([before, after].map((base) => fetch(new URL(path, base))));
    const bodies = await Promise.all(responses.map((response) => response.text()));
    assert.equal(responses[0]?.status, expectedStatus, `base status: ${path}`);
    assert.equal(responses[1]?.status, expectedStatus, `branch status: ${path}`);
    assert.equal(bodies[1], bodies[0], path);
    compared++;
    console.log(`identical ${expectedStatus}: ${path} (${Buffer.byteLength(bodies[0] ?? "")} bytes)`);
  }
  for (const card of overview.projects) {
    for (const suffix of ["", "?view=all"]) {
      await compare(`/api/projects/${encodeURIComponent(card.name)}${suffix}`);
    }
  }
  for (const query of ["fix", "overview", "a", "run", "", "verifier-no-such-ticket-846"]) {
    await compare(`/api/search?q=${encodeURIComponent(query)}`);
  }
  await compare("/api/projects/verifier-no-such-project-846", 404);
  await compare("/api/factory-runs");
  console.log(`Compared ${compared} API responses for ${overview.projects.length} projects.`);
} finally {
  for (const child of children) child.kill("SIGTERM");
  await Promise.all(children.map((child) => child.exited));
}
