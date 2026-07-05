/* Process scheduled Communication Center emails. */
const repo = require("./repository");
const { sendMessage } = require("./service");

let running = false;

async function processScheduledMessages() {
  if (running) return;
  running = true;
  try {
    const due = await repo.listDueScheduled();
    for (const msg of due) {
      try {
        await sendMessage(msg.id, msg.created_by);
        console.log(`[comm] scheduled message #${msg.id} sent`);
      } catch (e) {
        console.warn(`[comm] scheduled message #${msg.id} failed:`, e.message);
      }
    }
  } finally {
    running = false;
  }
}

function startCommunicationWorker(intervalMs = 60000) {
  processScheduledMessages().catch((e) => console.warn("[comm] worker:", e.message));
  setInterval(() => {
    processScheduledMessages().catch((e) => console.warn("[comm] worker:", e.message));
  }, intervalMs);
}

module.exports = { processScheduledMessages, startCommunicationWorker };
