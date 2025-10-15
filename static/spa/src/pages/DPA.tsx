// src/pages/DPA.tsx
import MarkdownPage from "./MarkdownPage";

const MD = `
# Data Processing Agreement (DPA)

**Effective Date:** July 29, 2025  

This Data Processing Agreement (“Agreement”) is between **Scipio Systems** (“Processor”, “we”, “us”, “our”) and the customer entity (“Controller”, “you”, “your”) using the **LexBot PRO** chat application (“Service”).

This Agreement is incorporated into and forms part of the Terms and Conditions for the Service.

---

## 1. Purpose

This Agreement sets out the terms under which we process personal data on your behalf in connection with your use of the Service.

---

## 2. Roles of the Parties

- You act as the **Data Controller**.  
- We act as the **Data Processor**.

Our Service may transmit, process, or store data using third-party sub-processors, specifically **OpenAI** (for document processing) and **Pinecone** (for vector storage).

---

## 3. Nature and Purpose of Processing

The Service processes data solely as necessary to provide document storage, retrieval, and AI-powered search functionality.  
Data you upload is transmitted to OpenAI and Pinecone for the purpose of providing the Service.

---

## 4. User Responsibilities

You are responsible for:

- Ensuring that you have the legal right to upload, process, and store any data (including personal data) via the Service.  
- Not uploading any data that is unlawful or in violation of GDPR or other applicable laws.  
- Informing your users, employees, or data subjects of how their data may be processed by third parties.  
- Obtaining any required consents or authorizations for processing personal data using the Service.

---

## 5. Sub-Processors

You acknowledge and agree that we use **OpenAI** and **Pinecone** as sub-processors for the provision of the Service.  
By using the Service, you authorize us to transfer your data to these sub-processors, subject to their own terms and privacy policies.

---

## 6. Data Subject Rights

We will, to the extent reasonably possible, assist you in fulfilling your obligations to respond to data subject requests (access, rectification, erasure, etc.), in accordance with GDPR.

---

## 7. Data Security

We implement technical and organizational measures to protect your data, but make no guarantees regarding the security practices of sub-processors.  
You are responsible for maintaining the confidentiality and security of your own account credentials.

---

## 8. Data Breach Notification

In the event of a data breach affecting your data, we will notify you without undue delay upon becoming aware of the breach.

---

## 9. Data Transfers

Data may be transferred, stored, and processed in countries outside the EEA by sub-processors.  
By using the Service, you consent to such transfers as necessary for provision of the Service.

---

## 10. Deletion and Return of Data

Upon termination of your account, you may request deletion of your data, subject to technical feasibility and sub-processor capabilities.

---

## 11. Liability

We shall not be liable for any unauthorized, unlawful, or non-compliant data uploaded by you or processed on your behalf.  
You remain solely responsible for compliance with all applicable data protection laws.

---

## 12. Changes to Sub-Processors

We may engage additional or replacement sub-processors upon notice to you (e.g., via website or email).

---

## 13. Governing Law

This Agreement is governed by the laws specified in the Terms and Conditions.

---

## 14. Contact

For any privacy or data protection questions, contact us at **[contact@lexbot.pro](mailto:contact@lexbot.pro)**.

**Scipio Systems**  
Jud. Timiş, Sat Giroc, Comuna Giroc, Strada BEGA, Nr. 56/3  
📧 [contact@lexbot.pro](mailto:contact@lexbot.pro)  
🌐 [www.lexbot.pro](https://www.lexbot.pro)

`;

export default function DPA() {
  return <MarkdownPage title="Data Processing Agreement (DPA)" updated="2025-07-29" md={MD} />;
}
