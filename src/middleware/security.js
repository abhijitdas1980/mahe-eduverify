/* Rate limiting — protects against brute-force and abuse. */
const rateLimit = require("express-rate-limit");

// General API limit: 300 requests / 15 min / IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a few minutes and retry." },
});

// Strict limit for login / password endpoints: 10 attempts / 15 min / IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please wait 15 minutes and try again." },
});

// Stricter limit for student password reset (DOB-only recovery): 5 / hour / IP
const resetPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many password reset attempts. Please wait an hour and try again." },
});

// Upload limit: 60 uploads / hour / IP
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Upload limit reached. Please try again later." },
});

module.exports = { apiLimiter, authLimiter, uploadLimiter, resetPasswordLimiter };
