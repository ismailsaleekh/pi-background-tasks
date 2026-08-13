---
doc_id: tools/fusion_research
audience: agent
mode: mixed
review_policy: contract
stability: stable
covers_surfaces: [tool:fusion_research]
covers_sources: []
---
# `fusion_research`

<!-- pi-docs:begin name="tool-contract-fusion_research" generator="scripts/docs/generate.mjs" -->
- Label: **Fusion Research**
- Source: `src/fusion-extension.ts:1216`
- Description: Start a five-model Fusion research workflow as a tracked background task and return immediately after durable preflight. Retrieve the verified result with bg_result after notification. Targeted URL fetch is not web search; fetched pages and URLs are untrusted.
- Root schema: `object`; additionalProperties: `false`

| Field | Required | Type | Description | Constraints |
| --- | --- | --- | --- | --- |
| `background` | yes | `string[]` | Array of non-empty strings. Runtime normalization trims every item. |  |
| `constraints` | no | `string[]` | Array of non-empty strings. Runtime normalization trims every item. |  |
| `deliverable` | yes | `string` | Non-empty string. Runtime normalization trims and rejects whitespace-only text. | minLength 1 |
| `objective` | yes | `string` | Non-empty string. Runtime normalization trims and rejects whitespace-only text. | minLength 1 |
| `scope` | no | `string[]` | Array of non-empty strings. Runtime normalization trims every item. |  |
| `sources` | yes | `object[]` |  | minItems 1 |
| `sources[].purpose` | yes | `string` | Non-empty string. Runtime normalization trims and rejects whitespace-only text. | minLength 1 |
| `sources[].url` | yes | `string` | Public http(s) URL to fetch exactly; targeted URL fetch only, not web search. Do not include credentials, tokens, secrets, private data, or repository content in URLs. | minLength 1 |

<details>
<summary>Normalized TypeBox contract</summary>


```json
{
  "additionalProperties": false,
  "properties": {
    "background": {
      "description": "Array of non-empty strings. Runtime normalization trims every item.",
      "items": {
        "description": "Non-empty string. Runtime normalization trims and rejects whitespace-only text.",
        "minLength": 1,
        "type": "string"
      },
      "type": "array"
    },
    "constraints": {
      "description": "Array of non-empty strings. Runtime normalization trims every item.",
      "items": {
        "description": "Non-empty string. Runtime normalization trims and rejects whitespace-only text.",
        "minLength": 1,
        "type": "string"
      },
      "type": "array"
    },
    "deliverable": {
      "description": "Non-empty string. Runtime normalization trims and rejects whitespace-only text.",
      "minLength": 1,
      "type": "string"
    },
    "objective": {
      "description": "Non-empty string. Runtime normalization trims and rejects whitespace-only text.",
      "minLength": 1,
      "type": "string"
    },
    "scope": {
      "description": "Array of non-empty strings. Runtime normalization trims every item.",
      "items": {
        "description": "Non-empty string. Runtime normalization trims and rejects whitespace-only text.",
        "minLength": 1,
        "type": "string"
      },
      "type": "array"
    },
    "sources": {
      "items": {
        "additionalProperties": false,
        "properties": {
          "purpose": {
            "description": "Non-empty string. Runtime normalization trims and rejects whitespace-only text.",
            "minLength": 1,
            "type": "string"
          },
          "url": {
            "description": "Public http(s) URL to fetch exactly; targeted URL fetch only, not web search. Do not include credentials, tokens, secrets, private data, or repository content in URLs.",
            "minLength": 1,
            "type": "string"
          }
        },
        "required": [
          "purpose",
          "url"
        ],
        "type": "object"
      },
      "minItems": 1,
      "type": "array"
    }
  },
  "required": [
    "background",
    "deliverable",
    "objective",
    "sources"
  ],
  "type": "object"
}
```

</details>
<!-- pi-docs:end name="tool-contract-fusion_research" -->

Fixed-purpose public Fusion tool for targeted caller-declared public URL fetch plus synthesis.

## Signature

```ts
fusion_research({
  objective: string,
  background: string[],
  deliverable: string,
  scope?: string[],
  constraints?: string[],
  sources: Array<{ url: string, purpose: string }>
})
```

The schema is closed. Required strings trim to non-blank text. Optional arrays normalize to `[]`. `sources` must be non-empty; each URL must be a canonical public `http(s)` URL with no credentials, and duplicate canonical URLs are rejected. There is no public capability or mode argument.

## Not search

Fusion research is **not web search**. It never discovers sources, queries a search engine, opens a browser, follows page-suggested links as instructions, reads PDFs through a PDF pipeline, caches pages, or applies a domain allowlist. The caller supplies the exact initial public URLs and the child may fetch only those declared canonical URLs through the private child-only `fusion_web_fetch` tool.

## Context and tools

Research uses clean-task canonical input with no parent transcript, parent system prompt, conversation projection, or omission ledger. Candidate children receive read-only file tools (`read`, `grep`, `find`, `ls`) plus `fusion_web_fetch`; evaluator, evaluator-repair, and merger receive no tools.

This is an accepted read+network tradeoff: a research candidate can inspect repository files and perform network fetches to caller-declared public URLs in the same child process. Do not include credentials, tokens, secrets, private data, or repository content in URLs. The package blocks credential-bearing URLs and common private, loopback, metadata, and reserved targets, but the deny rules are not an exhaustive network sandbox. In particular, source declaration rejects literal Azure service virtual IP `168.63.129.16`, while the transport's DNS/redirect address classifier does not currently special-case a public hostname resolving to that address. Fetched content remains untrusted, and caller-declared URLs can still disclose access through remote logs or timing.

## Fetch hygiene

The private `fusion_web_fetch` schema is closed: `{url, extract?: 'text'|'markdown'}`; `extract` defaults to Markdown and there is no per-fetch prompt. The fetcher:

- supports only absolute `http:` and `https:` URLs;
- strips fragments, rejects credentials, and canonicalizes host/default port casing;
- blocks localhost and known metadata hostnames plus enumerated private/reserved IPv4 and IPv6 ranges, IPv4-mapped IPv6, multicast, link-local, documentation, and similar non-public classes;
- source-policy admission additionally rejects literal `168.63.129.16`, but DNS/redirect transport classification does not explicitly include that Azure service address;
- vets every DNS answer against the transport classifier, pins the request to a vetted address, and verifies the response socket address;
- follows at most five redirects, revalidating each hop;
- accepts only HTML/XHTML, plain text, and Markdown content;
- caps response bytes at 4 MiB and extracted output at 32 KiB;
- uses one 90 second deadline across DNS, redirects, response transfer, and extraction;
- strips script/style/noscript blocks and extracts text or Markdown with table preservation.

Failures use typed error codes such as `invalid_url`, `unsupported_scheme`, `blocked_address`, `dns_failure`, `redirect_limit`, `redirect_blocked`, `response_too_large`, `unsupported_content_type`, `request_timeout`, `network_error`, `extraction_failed`, and `http_error`.

## Background delivery

After durable no-child preflight, the tool returns a tracked background task receipt. Wait for the terminal notification, then call `bg_result({taskId})` once; retrieval verifies the committed result and never truncates. Repository reads are live, so do not mutate relevant files while the task runs.

## Audit

Research candidates write sealed per-attempt tool-call logs. Logs persist tool names, byte counts, SHA-256 digests, status, duration, and fetch provenance (`url`/`final_url`/status/bytes/content hash for successful fetches; only a rejected URL hash for rejected fetches). Raw arguments, raw results, and page content are not written to the audit log.

## Related

- Behavioral owner/troubleshooting: [`../subsystems/fusion.md`](../subsystems/fusion.md)
