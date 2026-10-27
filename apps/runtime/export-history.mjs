// Offline, read-only migration using the official validated cold reader.
import { Context } from "@deepseek-ai/cordis";
import * as jsonl from "@deepseek-ai/dsh-session-persistence-jsonl";
import { readColdSessionLog } from "@deepseek-ai/dsh-session-query";
import { foldSessionTitle } from "@deepseek-ai/dsh-session-title";
const ctx = new Context();
try {
  await ctx
    .plugin(jsonl, { root: process.argv[2], compression: "none" })
    .await();
  const sessions = [];
  for (const row of await ctx.sessionPersistence.list()) {
    const cold = await readColdSessionLog(
      ctx.sessionPersistence,
      row.header.id,
    );
    sessions.push({
      id: row.header.id,
      title: foldSessionTitle(cold.events),
      events: cold.events,
    });
  }
  process.stdout.write(JSON.stringify(sessions));
} finally {
  await ctx.fiber.dispose();
}
