# Security Policy

QuackWrangler treats local datasets as sensitive. File parsing, queries, profiling, transforms, visualizations, and exports run locally in the VS Code extension host with DuckDB. The extension does not intentionally upload file contents to QuackWrangler-operated services.

The optional AI transform planner is disabled until a user configures an OpenAI API key. When invoked, it sends the user's instruction and schema metadata (column names, DuckDB types, and nullability) to OpenAI. It does not send rows, cell values, samples, or file contents. Proposed operations require user approval and pass through the same local validation as visual operations.

OpenAI API keys are stored with VS Code `SecretStorage`. They must never be placed in settings, workspace files, logs, issues, or source control.

Remote datasets necessarily contact the URL supplied by the user. Downloaded content is processed locally after retrieval.

## Supported Versions

Security updates are provided for the latest Marketplace release only.

| Version | Supported |
| ------- | --------- |
| 0.1.5   | ✅        |
| < 0.1.5 | ❌        |

Users should update to the latest version available from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=quackwrangler.quackwrangler).

## Reporting a Vulnerability

Please do not report suspected security vulnerabilities through public GitHub issues, discussions, social media, or Marketplace reviews.

Report vulnerabilities privately through [GitHub Private Vulnerability Reporting](https://github.com/mohsinsurani/quackwrangler/security/advisories/new).

Include as much of the following information as possible:

- A description of the vulnerability and its potential impact
- The affected QuackWrangler version, operating system, and VS Code version
- Steps or a minimal example that reproduces the issue
- Relevant logs, screenshots, or proof-of-concept code
- Whether the issue involves a local file, remote URL, generated SQL, webview, AI request, secret, export, or dependency
- Any suggested mitigation, if known

Do not include sensitive personal information, credentials, access tokens, or private datasets. Use a minimal synthetic dataset when possible.

## Response Process

You can expect:

- An acknowledgement within three business days
- An initial assessment within seven business days
- Progress updates at least every seven days while an accepted report remains unresolved
- Notification when a fix or mitigation becomes available

If the report is accepted, we will work to reproduce the issue, assess its severity, prepare a fix, and coordinate disclosure with the reporter.

If the report is declined, we will explain why it is not considered a security vulnerability when reasonably possible.

Response times are targets rather than guarantees, particularly for an independently maintained open-source project.

## Disclosure

Please allow reasonable time for investigation and remediation before publicly disclosing a vulnerability.

Security fixes will normally be released as a new Marketplace version. Relevant details and acknowledgements may be included in the release notes after users have had time to update, subject to the reporter's preferences.

## Security-Relevant Areas

Reports are especially helpful when they involve:

- Reading or modifying files outside the user-selected scope
- Unsafe handling of remote dataset URLs, redirects, or downloads
- SQL injection or bypasses in generated or custom queries
- Webview script injection or Content Security Policy bypasses
- Exposure of local file contents, credentials, tokens, or private metadata
- Unsafe archive extraction, export paths, or temporary-file handling
- Arbitrary command or code execution
- Vulnerable dependencies with a demonstrated impact on QuackWrangler
- Marketplace package integrity or update-chain concerns

## Out of Scope

The following are generally not treated as security vulnerabilities unless they demonstrate a concrete security impact:

- Feature requests or ordinary application bugs
- Unsupported or outdated QuackWrangler versions
- Dependency advisories without an exploitable path in QuackWrangler
- Denial-of-service reports requiring intentionally extreme local workloads
- Social-engineering attacks
- Issues that require the user to intentionally execute untrusted code outside QuackWrangler
- Reports generated only by automated scanners without reproduction steps or demonstrated impact

## Safe Harbor

Good-faith security research performed within the scope of this policy is welcome. Avoid privacy violations, data destruction, service disruption, and accessing data that does not belong to you.

We will not pursue action against researchers who comply with this policy and make a reasonable effort to avoid harm.
