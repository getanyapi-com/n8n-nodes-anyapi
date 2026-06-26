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

- **Run API** - execute any API by SKU with a normalized input payload. Returns `output`, `provider`, `costUsd`, and `items`.
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
3. Pick an API from the dropdown, for example **Google Search** or **Reddit Search**.
4. Fill the **Input** field with the normalized payload, for example:

   ```json
   { "query": "apify alternative" }
   ```

5. Execute. The node returns clean JSON plus the exact `costUsd` of the call.

## Resources

- [AnyAPI documentation](https://getanyapi.com/docs)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## License

[MIT](LICENSE)
