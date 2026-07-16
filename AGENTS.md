# AnyAPI n8n adapter instructions

This repository contains a handwritten customer-facing Adapter to AnyAPI. The authoritative
discovery topology, contract invariants, impact classifier, gates, and rollout order live in the
main repository's [ECOSYSTEM.md](https://github.com/getanyapi-com/anyapi/blob/main/ECOSYSTEM.md).
Read it before changing discovery, catalog, search, pricing, schemas, generated metadata, commands,
skills, or integration documentation.

Before editing:

1. Classify the change using `ECOSYSTEM.md` and include this n8n Adapter in the impact ledger.
2. Confirm whether the node's browse, search, detail, schema-mapping, or dropdown behavior is
   affected. Do not reconstruct customer discovery facts from internal registry or billing data.
3. Coordinate incompatible changes and releases in the order documented by the ecosystem map.

`nodes/AnyApi/discovery.ts` owns the customer-safe discovery Interface: paired requests/readers,
strict contract validation, and USD labels. `AnyApi.node.ts` owns n8n transport execution and UI
orchestration. Preserve that Seam instead of moving discovery facts back into the node class.

Run `npm ci && npm run check` before handoff. Discovery behavior is tested at the node's public
execute/load-options Seam in `tests/discovery-contract.test.cjs`; update those contract fixtures when
the authoritative Interface changes.
