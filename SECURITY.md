# Security

## Reporting a vulnerability

If you believe you've found a security issue in Pilcrow, please **do not
open a public GitHub issue**.

Instead, report it privately via GitHub's [private vulnerability reporting][1]:

> Go to the [Security tab][2] of this repository and click
> **Report a vulnerability**.

I'll acknowledge receipt within a few days and keep you updated as a fix is
worked on. Once a fix is released and users have had a reasonable window to
update, I'm happy to credit your report in the release notes.

## Scope

Pilcrow is a client that talks to a Wallabag server you control. The threat
model is therefore narrow:

- **In scope:** anything that could leak the user's Wallabag credentials,
  exfiltrate article contents to a third party, or allow an attacker to
  execute arbitrary code in the app context (e.g. via untrusted article
  HTML, deep-link handling, or the bookmarklet).
- **Out of scope:** issues in the Wallabag server itself (please report
  those at <https://github.com/wallabag/wallabag>), issues in dependencies
  with no realistic exploit path through Pilcrow, and missing security
  hardening on hosts running an old browser/OS that Pilcrow doesn't claim
  to support.

[1]: https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability
[2]: https://github.com/Christophe668/pilcrow/security
