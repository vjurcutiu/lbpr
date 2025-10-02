// src/pages/Privacy.tsx
import MarkdownPage from "./MarkdownPage";

const MD = `
## Overview
We respect your privacy. This notice explains what we collect, why we collect it, and how you can control it.

## What we collect
- **Account info.** Email, name, and authentication identifiers.
- **App activity.** Feature usage, diagnostics, crash logs.
- **Content you upload.** Files you choose to store and process.
- **Billing data.** Managed by our payment processor (we do not store card numbers).

## How we use data
- To provide and improve the service.
- To prevent abuse and maintain security.
- To comply with legal obligations.
- With your consent for optional features.

## Data sharing
We share minimal data with infrastructure and analytics providers strictly to operate the product. We do not sell personal data.

## Data retention
We keep data only as long as needed for the purposes above, or as required by law. You may request deletion of your account data at any time.

## Your choices
- Access, update, or delete your data.
- Export your data where technically feasible.
- Opt out of non-essential analytics.

## Children's privacy
This service is not directed to children under 13 (or older as required by your local law).

## Contact
Questions? Email **support@example.com**.

`;

export default function Privacy() {
  return <MarkdownPage title="Privacy Policy" updated={new Date().toISOString().slice(0,10)} md={MD} />;
}