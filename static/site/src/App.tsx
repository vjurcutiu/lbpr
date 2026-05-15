import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { SignalInNoiseHero } from './components/SignalInNoiseHero';

const DEFAULT_APP_URL =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://app.localhost'
    : 'https://app.lexbot.pro';

const APP_URL = import.meta.env.VITE_APP_URL ?? DEFAULT_APP_URL;
const SIGNUP_URL = `${APP_URL}/signup?highlight=email`;
const BILLING_URL = `${APP_URL}/billing`;

const LegalPage = lazy(() => import('./LegalPage'));
const LawyersPage = lazy(() => import('./LawyersPage'));

type PlanCardProps = {
  name: string;
  price: string;
  period: string;
  summary: string;
  features: string[];
  ctaLabel: string;
  ctaHref: string;
  featured?: boolean;
  footnote?: string;
};

type ComparisonRow = {
  label: string;
  free: string;
  pro: string;
};

type WorkflowCard = {
  tier: 'Core' | 'Pro';
  title: string;
  description: string;
};

const comparisonRows: ComparisonRow[] = [
  { label: 'Messages', free: '50 included', pro: '2,000 per month' },
  { label: 'File processing', free: '100,000 tokens (~75 pages)', pro: '20,000,000 tokens (~15,000 pages)' },
  { label: 'Workflow tokens', free: '100,000 included', pro: '5,000,000 per month' },
  { label: 'Transcription', free: '5 minutes', pro: '1,000 minutes per month' },
  { label: 'OCR', free: '5 images', pro: '1,000 images per month' },
  { label: 'Privacy support', free: 'Standard workspace controls', pro: 'PII pseudonymization' },
  { label: 'Help', free: 'Self-serve', pro: 'Phone and email support (≤24h SLA)' },
];

const workflowCards: WorkflowCard[] = [
  {
    tier: 'Core',
    title: 'Summarize large documents',
    description: 'Condense long contracts, research packs, pleadings, transcripts, or 300+ page files into a useful brief with key points and open questions.',
  },
  {
    tier: 'Core',
    title: 'Search across uploaded material',
    description: 'Find exact clauses, dates, language, and source passages across PDFs, audio transcripts, handwritten scanned documents, and large text files.',
  },
  {
    tier: 'Core',
    title: 'Extract legal information',
    description: 'Pull out parties, obligations, deadlines, governing law, clause language, and other structured fields from messy source material.',
  },
  {
    tier: 'Pro',
    title: 'Contract review',
    description: 'Unearth clauses, commercial risks, missing protections, negotiation points, and further actions in an editable output that can be refined for a client.',
  },
  {
    tier: 'Pro',
    title: 'Risk matrix and negotiation brief',
    description: 'Turn dense agreements into client-ready risk summaries, fallback positions, and practical negotiation notes without rebuilding the analysis from scratch.',
  },
  {
    tier: 'Pro',
    title: 'Matter handoff and presentations',
    description: 'Package review work into clear next steps, approval notes, and polished presentation-style outputs for colleagues, partners, or clients.',
  },
];

const workflowSteps = [
  'Upload contracts, scans, transcripts, research files, or matter documents.',
  'Search naturally or choose a workflow to process the selected material.',
  'Review a cited, editable output that can become a draft, brief, matrix, or presentation.',
];

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

function AppHeader() {
  return (
    <header className="site-header">
      <div className="site-shell site-header__inner">
        <a className="brand" href="/">
          Lexbot <span>Pro</span>
        </a>
        <nav className="site-nav" aria-label="Primary">
          <a href="/#workflow">How it works</a>
          <a href="/#workflows">Workflows</a>
          <a href="/#platform">Capabilities</a>
          <a href="/#pricing">Pricing</a>
        </nav>
        <div className="site-header__actions">
          <a className="button button--ghost" href={APP_URL}>
            Open app
          </a>
          <a className="button button--primary" href={SIGNUP_URL}>
            Start free
          </a>
        </div>
      </div>
    </header>
  );
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="section-heading">
      <div className="eyebrow-pill">{eyebrow}</div>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

function InfoCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="info-card">
      <h3>{title}</h3>
      <p>{children}</p>
    </article>
  );
}

function PlanCard({
  name,
  price,
  period,
  summary,
  features,
  ctaLabel,
  ctaHref,
  featured = false,
  footnote,
}: PlanCardProps) {
  return (
    <article className={`price-card${featured ? ' price-card--featured' : ''}`}>
      <div className="price-card__header">
        <div className="price-card__topline">
          <div className="price-card__name">{name}</div>
          {featured ? <div className="price-badge">Most popular</div> : null}
        </div>
        <div className="price-card__price-row">
          <div className="price-card__price">{price}</div>
          <div className="price-card__period">{period}</div>
        </div>
        <p className="price-card__summary">{summary}</p>
      </div>

      <ul className="price-card__features">
        {features.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>

      <div className="price-card__footer">
        {footnote ? <p className="price-card__footnote">{footnote}</p> : <div className="price-card__footnote price-card__footnote--placeholder" />}
        <a className={`button ${featured ? 'button--primary' : 'button--ghost'} price-card__button`} href={ctaHref}>
          {ctaLabel}
        </a>
      </div>
    </article>
  );
}

function PricingMatrix() {
  return (
    <div className="pricing-comparison" aria-label="Plan comparison">
      <div className="pricing-matrix pricing-matrix--desktop">
        <table className="pricing-table">
          <caption className="sr-only">Compare the Free and Pro plans</caption>
          <thead>
            <tr>
              <th scope="col">Included feature</th>
              <th scope="col">Free</th>
              <th scope="col">Pro</th>
            </tr>
          </thead>
          <tbody>
            {comparisonRows.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="pricing-table__label">{row.label}</th>
                <td>{row.free}</td>
                <td>{row.pro}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pricing-stack" aria-label="Mobile plan comparison">
        {comparisonRows.map((row) => (
          <article key={row.label} className="pricing-stack__card">
            <h3 className="pricing-stack__title">{row.label}</h3>
            <dl className="pricing-stack__list">
              <div className="pricing-stack__item">
                <dt>Free</dt>
                <dd>{row.free}</dd>
              </div>
              <div className="pricing-stack__item">
                <dt>Pro</dt>
                <dd>{row.pro}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </div>
  );
}

function HomePage() {
  return (
    <>
      <SignalInNoiseHero
        eyebrow="Legal document intelligence"
        title="Document Intelligence for Legal Teams"
        description="A legal search engine and customizable workflow layer for teams that need to search uploaded documents, analyze long matters, refine drafts, and turn dense contracts into client-ready work product."
        primaryCtaLabel="Start free"
        secondaryCtaLabel="See how it works"
        metrics={[
          { value: 'Search engine', label: 'for exact clauses and source language' },
          { value: 'Workflows', label: 'for reviews, briefs, and presentations' },
          { value: '300+ pages', label: 'analyze large documents naturally' },
        ]}
        onPrimaryClick={() => window.location.assign(SIGNUP_URL)}
        onSecondaryClick={() => document.getElementById('workflow')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      />

      <main>
        <section id="workflow" className="page-section page-section--dense">
          <div className="site-shell">
            <SectionHeading
              eyebrow="How it works"
              title="Upload legal material. Search it. Process it."
              description="Lexbot Pro helps legal teams move from scattered matter documents to cited answers and repeatable outputs, reducing repetitive document work by several hours each week."
            />
            <div className="info-grid info-grid--three">
              <InfoCard title="1. Bring the matter in">
                Upload contracts, exhibits, scanned pages, handwritten notes, transcripts, research files, and large text documents into one searchable workspace.
              </InfoCard>
              <InfoCard title="2. Search through the evidence">
                Ask natural-language questions, find exact clauses, and retrieve the source language your team needs before drafting, reviewing, or advising.
              </InfoCard>
              <InfoCard title="3. Run structured workflows">
                Process the same material into summaries, contract reviews, risk matrices, negotiation briefs, handoffs, and client-ready presentations.
              </InfoCard>
            </div>
          </div>
        </section>

        <section id="workflows" className="page-section page-section--dense">
          <div className="site-shell">
            <SectionHeading
              eyebrow="Workflows"
              title="Core search tasks and Pro legal work product"
              description="Use core workflows for fast document understanding, then move into Pro workflows when the output needs to identify clauses, risks, approvals, fallback language, and next actions."
            />

            <div className="workflow-layout">
              <div className="workflow-card-grid">
                {workflowCards.map((card) => (
                  <article key={card.title} className="workflow-card">
                    <div className={`workflow-card__badge workflow-card__badge--${card.tier.toLowerCase()}`}>{card.tier}</div>
                    <h3>{card.title}</h3>
                    <p>{card.description}</p>
                  </article>
                ))}
              </div>

              <aside className="workflow-panel">
                <div className="workflow-panel__label">How legal teams use them</div>
                <ol className="workflow-step-list">
                  {workflowSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <p className="workflow-panel__note">
                  Junior team members can start from structured workflows instead of blank prompts, then refine the output with AI prompts before a senior lawyer reviews or sends it onward.
                </p>
              </aside>
            </div>
          </div>
        </section>

        <section id="platform" className="page-section">
          <div className="site-shell two-column-layout">
            <div>
              <SectionHeading
                eyebrow="Capabilities"
                title="Built for the documents lawyers actually handle"
                description="From scanned exhibits to recorded calls and multilingual contracts, Lexbot Pro gives legal teams a practical way to search, analyze, and reuse the material already sitting in their files."
              />
              <div className="stack-list">
                <div>
                  <strong>Document and media intake</strong>
                  <span>Handle PDFs, large documents, handwritten scanned pages, images, transcripts, and audio without forcing legal material into a rigid format.</span>
                </div>
                <div>
                  <strong>Grounded legal search and chat</strong>
                  <span>Ask questions across uploaded files and keep answers anchored to source passages, exact clause language, and cited context.</span>
                </div>
                <div>
                  <strong>Editable work product</strong>
                  <span>Refine contract reviews, drafts, negotiation briefs, risk notes, and presentations using prompts instead of manually rebuilding the same analysis.</span>
                </div>
              </div>
            </div>
            <aside className="platform-panel">
              <div className="platform-panel__label">Legal use cases</div>
              <div className="platform-panel__row">
                <span>Contract review</span>
                <strong>Clauses, risks, approval notes, fallback positions</strong>
              </div>
              <div className="platform-panel__row">
                <span>Matter research</span>
                <strong>Large files, transcripts, scanned exhibits, source passages</strong>
              </div>
              <div className="platform-panel__row">
                <span>Client delivery</span>
                <strong>Briefs, summaries, negotiation notes, presentations</strong>
              </div>
              <div className="platform-panel__note">
                The goal is not just faster answers. It is faster movement from source material to a clearer draft, review, or client-facing deliverable.
              </div>
            </aside>
          </div>
        </section>

        <section id="pricing" className="page-section page-section--dense">
          <div className="site-shell">
            <SectionHeading
              eyebrow="Pricing"
              title="Start free. Upgrade when legal document work becomes recurring."
              description="The free plan is built to test real files quickly. Pro adds the monthly capacity, privacy support, OCR, transcription, and workflow usage needed for everyday legal work."
            />

            <div className="pricing-grid">
              <PlanCard
                name="Free"
                price="€0"
                period="per month"
                summary="A simple way to test legal search and document workflows with real material. No credit card required."
                features={[
                  '50 messages included',
                  '100,000 file processing tokens (≈75 pages)',
                  '100,000 workflow tokens',
                  '5 minutes of transcription',
                  '5 OCR images',
                  'Create an account and start with real legal files',
                ]}
                ctaLabel="Create free account"
                ctaHref={SIGNUP_URL}
              />

              <PlanCard
                name="Pro"
                price="Monthly"
                period="billing"
                summary="More capacity, stronger privacy support, and direct help for teams using legal search and workflows every day."
                features={[
                  '2,000 messages per month',
                  '20,000,000 file processing tokens (≈15,000 pages) per month',
                  '5,000,000 workflow tokens per month',
                  '1,000 minutes of transcription per month',
                  '1,000 OCR images per month',
                  'PII pseudonymization and phone + email support (≤24h SLA)',
                ]}
                ctaLabel="See Pro in the app"
                ctaHref={SIGNUP_URL}
                featured
                footnote="The Pro rate is managed in-app so checkout always reflects the current live price."
              />
            </div>

            <PricingMatrix />

            <p className="pricing-note">
              Need to compare the live Pro rate before upgrading? Open the billing area in the app to see the current checkout price and manage your plan.
              <a href={BILLING_URL}> View billing</a>
            </p>
          </div>
        </section>

        <section className="page-section page-section--dense">
          <div className="site-shell cta-panel">
            <div>
              <div className="eyebrow-pill">Ready to try it</div>
              <h2>Upload a real legal document and see how quickly it becomes useful</h2>
              <p>
                The fastest way to evaluate Lexbot Pro is with one of your own files. Start free, search for a clause, run a workflow, and see how the output feels in practice.
              </p>
            </div>
            <div className="cta-panel__actions">
              <a className="button button--primary" href={SIGNUP_URL}>
                Create free account
              </a>
              <a className="button button--ghost" href={APP_URL}>
                Open the app
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="site-shell site-footer__inner">
          <div>
            <div className="brand brand--footer">
              Lexbot <span>Pro</span>
            </div>
            <p>Document intelligence for legal teams.</p>
          </div>
          <div className="site-footer__links">
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href="/dpa">DPA</a>
            <a href={APP_URL}>App</a>
          </div>
        </div>
      </footer>
    </>
  );
}

const legalPageMeta = {
  '/privacy': 'Lexbot Pro | Privacy Policy',
  '/terms': 'Lexbot Pro | Terms & Conditions',
  '/dpa': 'Lexbot Pro | Data Processing Addendum',
} as const;

type LegalPathname = keyof typeof legalPageMeta;

export default function App() {
  const pathname = normalizePathname(window.location.pathname);
  const isLegalPath = pathname in legalPageMeta;
  const tryVariant = new URLSearchParams(window.location.search).get('try');
  const isLawyersPath = tryVariant === 'legal';

  useEffect(() => {
    document.title = isLegalPath
      ? legalPageMeta[pathname as LegalPathname]
      : isLawyersPath
        ? 'Lexbot Pro | Document search and legal workflows for lawyers'
        : 'Lexbot Pro | Document intelligence for legal teams';
  }, [isLegalPath, isLawyersPath, pathname]);

  let page: ReactNode;

  if (isLegalPath) {
    page = (
      <Suspense fallback={<main className="legal-page legal-page--loading" />}>
        <LegalPage pathname={pathname as LegalPathname} />
      </Suspense>
    );
  } else if (isLawyersPath) {
    page = (
      <Suspense fallback={<main className="lawyers-page lawyers-page--loading" />}>
        <LawyersPage appUrl={APP_URL} signupUrl={SIGNUP_URL} />
      </Suspense>
    );
  } else {
    page = <HomePage />;
  }

  return (
    <div className="site-root">
      <AppHeader />
      {page}
    </div>
  );
}
