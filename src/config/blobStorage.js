/* Azure Blob Storage — private student documents.
   Blobs are never public; the API issues short-lived SAS URLs or streams
   bytes through same-origin preview routes. */
const {
  BlobServiceClient,
  BlobSASPermissions,
  generateBlobSASQueryParameters,
  StorageSharedKeyCredential,
} = require("@azure/storage-blob");
const { DefaultAzureCredential } = require("@azure/identity");

const CONTAINER = (process.env.AZURE_STORAGE_CONTAINER || "eduverify-documents").trim();
const ACCOUNT = (process.env.AZURE_STORAGE_ACCOUNT_NAME || "").trim();
const SAS_MINUTES = Math.max(5, parseInt(process.env.AZURE_STORAGE_SAS_EXPIRY_MINUTES || "60", 10) || 60);

let _client = null;
let _sharedKeyCred = null;

function inferFormat(doc) {
  const fmt = String(doc?.file_format || "").toLowerCase().replace(/^\./, "");
  if (fmt) return fmt;
  const name = String(doc?.file_name || "").toLowerCase();
  const m = name.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "";
}

function extFromBuffer(buffer, fallback = "bin") {
  if (!buffer || buffer.length < 4) return fallback;
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) return "pdf";
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "jpg";
  return fallback;
}

function blobPath(appNo, docCode, ext) {
  const safeApp = String(appNo || "unknown").replace(/[^\w.\-]/g, "_");
  const safeCode = String(docCode || "DOC").replace(/[^\w.\-]/g, "_");
  const safeExt = String(ext || "bin").replace(/^\./, "").toLowerCase();
  return `${safeApp}/${safeCode}_${Date.now()}.${safeExt}`;
}

function resolveSharedKeyCredential() {
  if (_sharedKeyCred) return _sharedKeyCred;
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING || "";
  if (conn) {
    _sharedKeyCred = StorageSharedKeyCredential.fromConnectionString(conn);
    return _sharedKeyCred;
  }
  const key = process.env.AZURE_STORAGE_ACCOUNT_KEY || "";
  if (ACCOUNT && key) {
    _sharedKeyCred = new StorageSharedKeyCredential(ACCOUNT, key);
    return _sharedKeyCred;
  }
  return null;
}

function getBlobServiceClient() {
  if (_client) return _client;

  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING || "";
  if (conn) {
    _client = BlobServiceClient.fromConnectionString(conn);
    return _client;
  }

  if (!ACCOUNT) {
    throw new Error("AZURE_STORAGE_ACCOUNT_NAME is not set");
  }

  const shared = resolveSharedKeyCredential();
  if (shared) {
    _client = new BlobServiceClient(`https://${ACCOUNT}.blob.core.windows.net`, shared);
    return _client;
  }

  const credOpts = {};
  if (process.env.AZURE_CLIENT_ID) {
    credOpts.managedIdentityClientId = process.env.AZURE_CLIENT_ID;
  }
  const credential = new DefaultAzureCredential(credOpts);
  _client = new BlobServiceClient(`https://${ACCOUNT}.blob.core.windows.net`, credential);
  return _client;
}

function blockBlobClient(blobName) {
  return getBlobServiceClient().getContainerClient(CONTAINER).getBlockBlobClient(blobName);
}

async function ensureContainer() {
  const container = getBlobServiceClient().getContainerClient(CONTAINER);
  await container.createIfNotExists();
}

/** Upload a file buffer. Returns Cloudinary-compatible shape for existing routes. */
async function uploadBuffer(buffer, appNo, docCode) {
  await ensureContainer();
  const ext = extFromBuffer(buffer, "bin");
  const path = blobPath(appNo, docCode, ext);
  const client = blockBlobClient(path);
  await client.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentTypeForExt(ext) },
  });
  return {
    public_id: path,
    resource_type: "raw",
    format: ext,
  };
}

function contentTypeForExt(ext) {
  const e = String(ext || "").toLowerCase();
  if (e === "pdf") return "application/pdf";
  if (e === "png") return "image/png";
  if (["jpg", "jpeg", "jfif"].includes(e)) return "image/jpeg";
  return "application/octet-stream";
}

function buildSasUrl(blobName, { attachment = false } = {}) {
  return buildSasUrlAsync(blobName, { attachment });
}

async function buildSasUrlAsync(blobName, { attachment = false } = {}) {
  if (!ACCOUNT && !process.env.AZURE_STORAGE_CONNECTION_STRING) return null;

  const accountName =
    ACCOUNT ||
    (process.env.AZURE_STORAGE_CONNECTION_STRING || "").match(/AccountName=([^;]+)/i)?.[1];
  if (!accountName) return null;

  const startsOn = new Date(Date.now() - 60 * 1000);
  const expiresOn = new Date(Date.now() + SAS_MINUTES * 60 * 1000);
  const sasParams = {
    containerName: CONTAINER,
    blobName,
    permissions: BlobSASPermissions.parse("r"),
    startsOn,
    expiresOn,
    contentDisposition: attachment ? `attachment; filename="${blobName.split("/").pop()}"` : undefined,
  };

  const shared = resolveSharedKeyCredential();
  let sas;
  if (shared) {
    sas = generateBlobSASQueryParameters(sasParams, shared).toString();
  } else {
    const service = getBlobServiceClient();
    const delegationKey = await service.getUserDelegationKey(startsOn, expiresOn);
    sas = generateBlobSASQueryParameters(sasParams, delegationKey, accountName).toString();
  }

  return `https://${accountName}.blob.core.windows.net/${CONTAINER}/${encodeURI(blobName)}?${sas}`;
}

/** Time-limited read URL (account key or Managed Identity user-delegation SAS). */
function signedUrl(doc, attachment = false) {
  if (!doc?.file_public_id) return null;
  const shared = resolveSharedKeyCredential();
  if (shared || ACCOUNT) {
    return buildSasUrlSync(doc.file_public_id, { attachment });
  }
  return null;
}

function buildSasUrlSync(blobName, opts) {
  const shared = resolveSharedKeyCredential();
  if (!shared || !ACCOUNT) return null;
  const startsOn = new Date(Date.now() - 60 * 1000);
  const expiresOn = new Date(Date.now() + SAS_MINUTES * 60 * 1000);
  const sas = generateBlobSASQueryParameters(
    {
      containerName: CONTAINER,
      blobName,
      permissions: BlobSASPermissions.parse("r"),
      startsOn,
      expiresOn,
      contentDisposition: opts.attachment ? `attachment; filename="${blobName.split("/").pop()}"` : undefined,
    },
    shared
  ).toString();
  return `https://${ACCOUNT}.blob.core.windows.net/${CONTAINER}/${encodeURI(blobName)}?${sas}`;
}

/** Async signed URL for routes that can await (Managed Identity). */
async function signedUrlAsync(doc, attachment = false) {
  if (!doc?.file_public_id) return null;
  return buildSasUrlAsync(doc.file_public_id, { attachment });
}

async function fetchAssetBuffer(doc) {
  if (!doc?.file_public_id) return null;
  if (!isConfigured()) throw new Error("Document storage is not configured");

  const client = blockBlobClient(doc.file_public_id);
  const exists = await client.exists();
  if (!exists) {
    throw new Error(`fetch failed for ${doc.doc_code}: blob not found`);
  }
  const dl = await client.downloadToBuffer();
  return dl.length > 0 ? dl : null;
}

async function destroyAsset(publicId) {
  if (!publicId) return;
  try {
    const client = blockBlobClient(publicId);
    await client.deleteIfExists();
  } catch (e) {
    console.warn("Azure Blob delete failed:", e.message);
  }
}

function isConfigured() {
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) return true;
  if (ACCOUNT && process.env.AZURE_STORAGE_ACCOUNT_KEY) return true;
  if (ACCOUNT && (process.env.NODE_ENV === "production" || process.env.AZURE_USE_MANAGED_IDENTITY === "true")) {
    return true;
  }
  return false;
}

module.exports = {
  uploadBuffer,
  signedUrl,
  signedUrlAsync,
  fetchAssetBuffer,
  destroyAsset,
  isConfigured,
  inferFormat,
};
