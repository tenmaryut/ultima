# Security policy

Please report security problems **privately** using GitHub's
[private vulnerability reporting](https://github.com/tenmaryut/ultima/security/advisories/new)
instead of a public issue. Include steps to reproduce and the affected version.

Areas we care about most:

- anything that lets a document, an AI answer or a web page run code or programs on the user's computer;
- the AI bridge in `src/main/ai/` (process spawning, arguments, environment);
- file access outside what the user picked in a dialog;
- leaks of AI tool credentials (Ultima must never read them).

Supported versions: the latest release.
