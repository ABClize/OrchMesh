// Read-only slices through DSH's public persistence API. Never restore a writer:
// cold query readers synthesize interrupted-turn closers, unsuitable for cursors.
import { Context } from "@deepseek-ai/cordis";
import * as Jsonl from "@deepseek-ai/dsh-session-persistence-jsonl";
const ctx = new Context();
try {
  await ctx.plugin(Jsonl, { root: process.argv[2], compression: "none" }).await();
  const id = process.argv[3];
  if (!(await ctx.sessionPersistence.stat(id))) {
    process.stdout.write(JSON.stringify({ available: false, events: [] }));
  } else {
    const handle = await ctx.sessionPersistence.open(id, "read");
    try {
      const { events } = await handle.read(Number(process.argv[4]), Number(process.argv[5]));
      process.stdout.write(JSON.stringify({ available: true, events }));
    } finally {
      await handle.close();
    }
  }
} catch {
  // SDK diagnostics can contain private request contents and host paths.
  process.exitCode = 1;
} finally {
  await ctx.fiber.dispose();
}
