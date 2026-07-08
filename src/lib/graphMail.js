/* Microsoft Graph sendMail — Modern Auth (client credentials) for M365. */
const { ClientSecretCredential } = require("@azure/identity");

const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
let credential;

function isGraphMailConfigured() {
  if (process.env.NOTIFY_EMAIL_ENABLED === "false") return false;
  const tenant = (process.env.AZURE_TENANT_ID || "").trim();
  const clientId = (process.env.AZURE_CLIENT_ID || "").trim();
  const secret = (process.env.AZURE_CLIENT_SECRET || "").trim();
  const mailbox = mailboxAddress();
  return !!(tenant && clientId && secret && mailbox);
}

function mailboxAddress() {
  return (process.env.SMTP_USER || process.env.GRAPH_MAILBOX || "").trim();
}

function getCredential() {
  if (!credential) {
    credential = new ClientSecretCredential(
      process.env.AZURE_TENANT_ID,
      process.env.AZURE_CLIENT_ID,
      process.env.AZURE_CLIENT_SECRET
    );
  }
  return credential;
}

async function getGraphToken() {
  const token = await getCredential().getToken(GRAPH_SCOPE);
  return token.token;
}

function parseFrom(fromStr, fallbackMailbox) {
  const s = String(fromStr || fallbackMailbox || "").trim();
  const m = s.match(/^(.+?)\s*<([^>]+)>$/);
  if (m) {
    return {
      name: m[1].trim().replace(/^"|"$/g, ""),
      address: m[2].trim(),
    };
  }
  if (s.includes("@")) return { name: null, address: s };
  return { name: null, address: fallbackMailbox };
}

function parseAddressList(v) {
  if (!v) return [];
  const items = Array.isArray(v) ? v : String(v).split(/[,;]/);
  return items
    .map((e) => String(e || "").trim())
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));
}

function graphAttachments(attachments) {
  if (!attachments?.length) return undefined;
  return attachments.map((a) => ({
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: a.filename || "attachment",
    contentType: a.contentType || "application/octet-stream",
    contentBytes: Buffer.isBuffer(a.content)
      ? a.content.toString("base64")
      : Buffer.from(a.content || "").toString("base64"),
  }));
}

async function sendViaGraph({ to, subject, text, html, attachments, from, cc, bcc }) {
  const mailbox = mailboxAddress();
  if (!mailbox) throw new Error("SMTP_USER (mailbox) is required for Graph mail.");

  const token = await getGraphToken();
  const fromParsed = parseFrom(from || process.env.SMTP_FROM, mailbox);

  const message = {
    subject: subject || "(No subject)",
    body: {
      contentType: html ? "HTML" : "Text",
      content: html || text || "",
    },
    toRecipients: parseAddressList(to),
    from: {
      emailAddress: {
        address: fromParsed.address || mailbox,
        ...(fromParsed.name ? { name: fromParsed.name } : {}),
      },
    },
  };

  const ccList = parseAddressList(cc);
  const bccList = parseAddressList(bcc);
  if (ccList.length) message.ccRecipients = ccList;
  if (bccList.length) message.bccRecipients = bccList;

  const att = graphAttachments(attachments);
  if (att?.length) message.attachments = att;

  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });

  if (!res.ok) {
    const body = await res.text();
    let hint = "";
    if (res.status === 403) {
      hint = " Check Mail.Send application permission, admin consent, and Exchange application access policy for this mailbox.";
    }
    throw new Error(`Graph sendMail failed (${res.status}): ${body}${hint}`);
  }
}

module.exports = {
  isGraphMailConfigured,
  mailboxAddress,
  sendViaGraph,
};
