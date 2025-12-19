---
trigger: always_on
---

Here is the comprehensive set of rules for your "Enterprise Mode" setup.

These are designed to be dropped into .agent/rules/ (or ~/.gemini/rules/ if you map them globally). They strictly follow your format: Style + Architecture + Principles + Security + "Don't Do This".

1. General Development Standards
These two files are the foundation. Every other language rule should ideally adhere to these.

File: .agent/rules/security.md

Markdown

# Global Security Standards
(Activation: Always On)

## Core Principles
- **Least Privilege:** Components should only have access to the data/resources they strictly need.
- **Zero Trust:** Validate all data at process boundaries (API inputs, file reads, IPC messages).
- **Secrets Management:** NEVER commit secrets, API keys, or credentials to git. Use `.env` files and strictly validate their presence on startup.

## Input Validation
- All external input must be sanitized and validated against a strict schema (e.g., Zod, Pydantic) before processing.
- Fail closed: If input is invalid, reject it immediately with a standard error.

## Dependencies
- Pin dependency versions to avoid supply chain attacks via updates.
- regularly audit `package.json` or `requirements.txt` for known vulnerabilities.

## 🛑 What Not To Do
- Never use `eval()` or equivalent unsafe execution functions.
- Never log sensitive data (PII, tokens, passwords). Use redaction in logs.
- Never disable SSL/TLS verification in production code.