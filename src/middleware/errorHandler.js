/* Central error handler — keeps internal details out of API responses. */
function isDbUnavailable(err) {
  const code = err && err.code;
  const msg = String((err && err.message) || "");
  return (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ECONNRESET" ||
    code === "57P01" ||
    code === "53300" ||
    /DATABASE_URL|connection terminated|password authentication failed|getaddrinfo/i.test(msg)
  );
}

module.exports = function errorHandler(err, req, res, _next) {
  console.error("ERROR:", err.stack || err.message || err);

  if (isDbUnavailable(err)) {
    return res.status(503).json({
      error: "The database is temporarily unavailable. Please try again shortly.",
    });
  }

  const status = err.status || 500;
  res.status(status).json({
    error:
      status === 500
        ? "Something went wrong on our side. Please try again."
        : err.message || "Request failed.",
  });
};
