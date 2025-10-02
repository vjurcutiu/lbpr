// src/pages/Terms.tsx
import MarkdownPage from "./MarkdownPage";

const MD = `
## Acceptance of terms
By using the app, you agree to these terms. If you do not agree, do not use the service.

## Your responsibilities
- Keep your account secure.
- Use the service lawfully and respectfully.
- Do not abuse rate limits or attempt to disrupt the platform.

## Intellectual property
You retain rights to your content. You grant us the rights necessary to host, process, and display it to provide the service.

## Payment & subscriptions
Paid features are billed according to the plan you select. Subscriptions renew until canceled. Taxes may apply.

## Disclaimers
The service is provided **"as is"** without warranties of any kind. To the extent permitted by law, we disclaim all liability for indirect or consequential damages.

## Termination
We may suspend or terminate accounts that violate these terms or create risk to others.

## Governing law
These terms are governed by the laws applicable in your jurisdiction, unless local law requires otherwise.

## Changes
We may update these terms. Continued use after updates constitutes acceptance.
`;

export default function Terms() {
  return <MarkdownPage title="Terms of Service" updated={new Date().toISOString().slice(0,10)} md={MD} />;
}