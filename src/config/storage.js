/* Document storage facade — Azure Blob (production) or Cloudinary (legacy). */
function resolveProvider() {
  const explicit = (process.env.STORAGE_PROVIDER || "").trim().toLowerCase();
  if (explicit) return explicit;
  if (process.env.AZURE_STORAGE_ACCOUNT_NAME || process.env.AZURE_STORAGE_CONNECTION_STRING) {
    return "azure";
  }
  if (
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  ) {
    return "cloudinary";
  }
  return "azure";
}

const provider = resolveProvider();

const impl =
  provider === "cloudinary"
    ? require("./cloudinary")
    : require("./blobStorage");

function storageProvider() {
  return provider;
}

module.exports = {
  storageProvider,
  uploadBuffer: impl.uploadBuffer,
  signedUrl: impl.signedUrl,
  fetchAssetBuffer: impl.fetchAssetBuffer,
  destroyAsset: impl.destroyAsset,
  isConfigured: impl.isConfigured,
};
