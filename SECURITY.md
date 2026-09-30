# Security Policy

## Supported version

Security fixes are prepared for the latest NARADA release candidate and the latest production release.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting / Security Advisory mechanism for this repository when available. Do not include sensitive exploit details in a public issue.

A useful report should include the affected version, Android version, reproduction steps, impact, and any proof-of-concept material needed to validate the issue.

## Security boundaries

NARADA intentionally restricts native downloads to HTTPS OJK hosts, keeps application data inside the Android sandbox, disables cleartext traffic and application backup, and exposes only a constrained local WebView/native bridge. Security changes to those boundaries require review and regression testing before release.
