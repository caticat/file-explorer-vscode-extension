# Security Policy

## Supported Versions

Security fixes are handled on the latest published version of Simple File
Explorer.

## Reporting a Vulnerability

Please report security-sensitive issues through GitHub security advisories when
available, or open a GitHub issue with only the minimum detail needed to start a
private follow-up.

Do not include private file contents, secrets, access tokens, or confidential
paths in public issues.

## Privacy Notes

Simple File Explorer runs inside the VS Code extension host for the current
workspace. It does not upload file names, paths, or file contents to any
external service.

File browsing, search, terminals, watchers, and file operations use local or
remote workspace file-system APIs provided by VS Code and Node.js.
