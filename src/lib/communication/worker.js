/* Process scheduled and queued Communication Center emails. */
const repo = require("./repository");
const { sendMessage } = require("./service");

let running = false;

async function processCommunicationQueue() {
  if (running) return { skipped: true };
  running = true;
  const results = [];
  try {
    await repo.resetStuckSending(15);

    const due = await repo.listDueScheduled();
    for (const msg of due) {
      try {
        await repo.updateMessage(msg.id, { status: "queued" });
      } catch (e) {
        console.warn(`[comm] promote scheduled #${msg.id}:`, e.message);
      }
    }

    const queued = await repo.listQueuedMessages(2);
    for (const msg of queued) {
      try {
        const result = await sendMessage(msg.id, msg.created_by);
        console.log(`[comm] message #${msg.id} sent=${result.sent} failed=${result.failed}`);
        results.push({ id: msg.id, ok: true, ...result });
      } catch (e) {
        console.warn(`[comm] message #${msg.id} failed:`, e.message);
        await repo.updateMessage(msg.id, { status: "failed", stats: { error: e.message } }).catch(() => {});
        results.push({ id: msg.id, ok: false, error: e.message });
      }
    }
  } finally {
    running = false;
  }
  return { processed: results.length, results };
}

function startCommunicationWorker(intervalMs = 15000) {
  processCommunicationQueue().catch((e) => console.warn("[comm] worker:", e.message));
  setInterval(() => {
    processCommunicationQueue().catch((e) => console.warn("[comm] worker:", e.message));
  }, intervalMs);
}

module.exports = { processCommunicationQueue, startCommunicationWorker };
