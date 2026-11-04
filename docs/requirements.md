# v1 requirement traceability

The source requirements were a proposal. The implementation scope is the
subsequently approved Accord v1 plan and the decisions made for this project.
All examples in the repository are fictional.

| Requirement                 | Implementation                                                                | Verification                                                       |
| --------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| R1: understand shared work  | Attention views, next owners, review dates, explicit unverified reports       | Browser/domain tests; pilot usefulness pending                     |
| R2: continuity              | Stable workstreams, blocker conditions, per-record material audit             | Domain and PostgreSQL tests                                        |
| R3: bounded authority       | Immutable action revisions, human-only grants, expiry/revocation/limits       | Domain/API/MCP/credential tests                                    |
| R4: what happened           | Attempts, observed results, evidence, uncertainty and reconciliation          | Domain/MCP tests; hosted provider-double exercise pending          |
| R5: closure                 | Criterion evidence, human confirmation, partial review, distinct dispositions | Domain/browser tests                                               |
| R6: source responsibility   | Explicit references, check time, conflicts, no automatic import               | Domain tests                                                       |
| R7: secure MCP              | Scoped identities, schemas, common service, versions, retry keys              | Actual transport and PostgreSQL tests; hosted revocation pending   |
| R8: recurring visibility    | Separate operations, latest vs verified execution, deduplicated incidents     | Domain tests                                                       |
| R9: private and recoverable | Auth/MFA, RLS, private evidence, scoped archives, restoration                 | Local boundary/recovery tests; hosted Auth/Storage restore pending |
| R10: portable open source   | MIT, install guide, generic client, fictional fixtures, CI                    | Reproducible local checks; independent installation pending        |

No claim of full v1 acceptance is made until hosted checks, another person's
installation, and the owner's real-work usefulness acceptance are recorded.

## Projects, tasks, and decisions redesign

| Approved behavior                               | Implementation                                                                            | Local evidence                                              |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Projects organize tasks without granting access | Existing workstream IDs plus optional project membership; scoped project context          | Assignment/isolation tests, populated legacy upgrade test   |
| Simple and verified completion                  | Explicit UI policy; human-only requirement changes; common completion guards              | Domain and desktop/mobile creation/completion journeys      |
| Decisions with actionable feedback              | Immutable decision responses; revision-bound approvals; completion return for changes     | Domain, REST/MCP, and browser decision journeys             |
| Snooze without changing authority               | Version-bound reminders invalidated by material events                                    | Expiry/invalidation and queue tests                         |
| List/board and URL task panels                  | Shared domain transitions, combinable URL filters, route-addressable panels               | Desktop/mobile filters, panels, blockers and status menus   |
| Accessible precision interface                  | Self-hosted fonts, visible focus, native dialogs, reduced motion, responsive queue/detail | Keyboard, axe WCAG AA scans, overflow and screenshot review |
| Upgrade and recovery compatibility              | Additive migration; v2 archives with v1 importer                                          | Populated legacy migration and archive restoration tests    |

Hosted migration, deployment, provider integration, and real-work acceptance remain separate gates.

## People relationship manager

Accord also tracks private contacts, meaningful interactions, important dates,
stay-in-touch cadences and commitments in both directions. Contacts have no login;
People agent permissions are explicit and independent of task assignments. Required
commitments gate task completion without replacing evidence or approval rules.
See [People](people.md) for the implemented behavior and excluded integrations.
