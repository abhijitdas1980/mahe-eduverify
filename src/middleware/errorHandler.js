/* Central error handler — keeps internal details out of API responses. */
module.exports = function errorHandler(err, _req, res, _next) {
  console.error("ERROR:", err.stack || err.message || err);
  const status = err.status || 500;
  res.status(status).json({
    error:
      status === 500
        ? "Something went wrong on our side. Please try again."
        : err.message || "Request failed.",
  });
};
