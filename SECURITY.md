# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.5.x   | :white_check_mark: |
| 0.4.x   | :white_check_mark: |
| < 0.4   | :x:                |

## Reporting a Vulnerability

**Do not open a public issue.** Security vulnerabilities must be reported privately.

Email: **security@sinopebase.dev**

You will receive a response within 48 hours with:
- Confirmation of receipt
- An assessment of severity
- A timeline for the fix

We practice coordinated disclosure:
1. Report is acknowledged within 48 hours
2. Fix is developed and tested
3. A security advisory is published on GitHub
4. Credit is given to the reporter (unless you prefer anonymity)

## Scope

- The Sinopebase server binary and its HTTP API surface
- The `sinopebase` SDK package
- The admin UI (`/_/`)
- The Docker image and Railway deployment template

## Out of Scope

- Deployments where the operator has disabled security defaults (HSTS, rate limiting, CORS whitelisting)
- Issues in user-deployed Edge Functions
- Issues in user-configured Mastra AI agents
- Phishing or social engineering attacks against instance operators
