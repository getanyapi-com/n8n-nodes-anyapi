# n8n-nodes-anyapi

This is an n8n community node. It lets you use [AnyAPI](https://getanyapi.com) in your n8n workflows.

AnyAPI is a unified marketplace for scraping and data APIs: reach hundreds of third-party APIs through one key, pay per request in real USD, no subscription. AnyAPI normalizes the response schema across providers and fails over automatically on error.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

[Installation](#installation) · [Operations](#operations) · [Credentials](#credentials) · [Usage](#usage) · [Resources](#resources)

## Installation

Follow the [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/).

In n8n, go to **Settings > Community Nodes**, select **Install**, and enter:

```
n8n-nodes-anyapi
```

## Operations

The node exposes one **AnyAPI** node with four operations:

- **Run API** - execute any API by SKU. Inputs render as typed fields loaded from the API schema (or raw JSON if you prefer). Returns `output`, `provider`, `costUsd`, and `items`.
- **Get API Schema** - fetch the input and output JSON Schema for one API.
- **List APIs** - browse the AnyAPI catalog, optionally filtered by query and category.
- **Get Balance** - return the remaining wallet balance in USD.

The **API** dropdown loads live from the AnyAPI catalog, so every available SKU is selectable and newly added providers appear automatically.

### Response budget options (Run API)

These trim the response payload without changing what you are charged:

- **Fields** - comma-separated keys to keep on each result item (dotted paths like `author.name` allowed).
- **Max Items** - cap the number of result items returned.
- **Summary Only** - return only a structural outline instead of the full data.

## Credentials

You need an AnyAPI key.

1. Create an account at [getanyapi.com/dashboard](https://getanyapi.com/dashboard).
2. Copy your API key.
3. In n8n, create new **AnyAPI API** credentials and paste the key.

The credential is validated against the wallet balance endpoint when you save it. New accounts start with a small free credit, so you can test before topping up.

## Usage

1. Add the **AnyAPI** node to your workflow.
2. Select **Run API**.
3. Pick an API from the dropdown, for example **Google Search** or **Reddit Search**. Each option shows its live price (per request, per result, or both).
4. Provide the input. There are two **Input Mode** choices:
   - **Fields (from schema)** - the default. The node loads the selected API's input schema and renders typed fields, with required fields flagged and enum fields shown as dropdowns. No JSON to hand write.
   - **JSON** - provide the raw payload, useful for expressions, for example:

     ```json
     { "query": "apify alternative" }
     ```

5. Execute. The node returns clean JSON plus the exact `costUsd` of the call.

## Example workflows

**Local lead machine** - type a niche and a city, scrape Google Maps with contact details, and write a personalized opener per business:

1. **Form Trigger** - fields: `Business type`, `Location`.
2. **AnyAPI** (Run API) - select **Google Maps Contacts** (`maps.contacts`), input:

   ```json
   { "query": "{{ $json['Business type'] }}", "location": "{{ $json['Location'] }}", "limit": 10 }
   ```

3. **Split Out** on `output.data.items` to get one item per business.
4. **AI Agent** - drafts a personalized outreach line from each business.
5. **Google Sheets** (Append) - log the enriched leads.

**Company 360 brief** - fan out across several AnyAPI endpoints on one key (Google News, Trustpilot, Similarweb, Reddit, LinkedIn), merge them, and have an AI agent write a one-page company brief. Because every source shares the same credential and response envelope (`output` + `costUsd`), adding a sixth source is just another AnyAPI node.

## Resources

- [AnyAPI documentation](https://getanyapi.com/docs)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## License

[MIT](LICENSE)
