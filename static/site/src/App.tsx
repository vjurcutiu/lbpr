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

const comparisonRows: ComparisonRow[] = [
  { label: 'Messages', free: '50 included', pro: '10,000 per month' },
  { label: 'Uploads', free: '100,000 tokens (~75 pages)', pro: '20,000,000 tokens (~15,000 pages)' },
  { label: 'Transcription', free: '5 minutes', pro: '1,000 minutes per month' },
  { label: 'OCR', free: '5 images', pro: '1,000 images per month' },
  { label: 'Privacy support', free: 'Standard workspace controls', pro: 'PII pseudonymization' },
  { label: 'Help', free: 'Self-serve', pro: 'Phone and email support (≤24h SLA)' },
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
        eyebrow="Answers grounded in your content"
        title="Find the signal across your documents"
        description="Upload files, process messy source material, and give your team a faster way to get reliable answers from the information they already have."
        primaryCtaLabel="Start free"
        secondaryCtaLabel="See how it works"
        metrics={[
          { value: 'Minutes', label: 'from upload to answer' },
          { value: 'Hybrid', label: 'search + reasoning' },
          { value: 'One place', label: 'files, chat, and usage' },
        ]}
        onPrimaryClick={() => window.location.assign(SIGNUP_URL)}
        onSecondaryClick={() => document.getElementById('workflow')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      />

      <main>
        <section id="workflow" className="page-section page-section--dense">
          <div className="site-shell">
            <SectionHeading
              eyebrow="How it works"
              title="Go from raw files to reliable answers"
              description="Lexbot Pro helps teams move from scattered documents and media to searchable knowledge and grounded responses without adding friction to the workflow."
            />
            <div className="info-grid info-grid--three">
              <InfoCard title="1. Bring everything in">
                Upload documents, scans, images, or audio so the material your team depends on lives in one place.
              </InfoCard>
              <InfoCard title="2. Process the messy parts">
                Use OCR, transcription, chunking, and retrieval to turn hard-to-search source material into usable context.
              </InfoCard>
              <InfoCard title="3. Ask better questions">
                Get fast answers grounded in your content so research, operations, and client work move forward with less hunting around.
              </InfoCard>
            </div>
          </div>
        </section>

        <section id="platform" className="page-section">
          <div className="site-shell two-column-layout">
            <div>
              <SectionHeading
                eyebrow="Capabilities"
                title="Built for real-world knowledge work"
                description="From multilingual files to scanned pages and recorded conversations, Lexbot Pro is designed for the kinds of inputs teams actually deal with every day."
              />
              <div className="stack-list">
                <div>
                  <strong>Document and media intake</strong>
                  <span>Handle PDFs, notes, scans, images, and audio without forcing your team into a rigid format.</span>
                </div>
                <div>
                  <strong>Grounded search and chat</strong>
                  <span>Retrieve relevant context first, then generate answers that stay anchored to your workspace content.</span>
                </div>
                <div>
                  <strong>Controls for teams</strong>
                  <span>Keep usage visible, manage plans in one place, and move from trial workflows to day-to-day production use.</span>
                </div>
              </div>
            </div>
            <aside className="platform-panel">
              <div className="platform-panel__label">Common use cases</div>
              <div className="platform-panel__row">
                <span>Operations</span>
                <strong>SOPs, process docs, internal handbooks</strong>
              </div>
              <div className="platform-panel__row">
                <span>Client delivery</span>
                <strong>Research packs, transcripts, and source files</strong>
              </div>
              <div className="platform-panel__row">
                <span>Global teams</span>
                <strong>Multilingual content in one searchable workspace</strong>
              </div>
              <div className="platform-panel__note">
                Start with a simple free workflow, then scale into higher usage, stronger privacy features, and faster support when the workload grows.
              </div>
            </aside>
          </div>
        </section>

        <section id="pricing" className="page-section page-section--dense">
          <div className="site-shell">
            <SectionHeading
              eyebrow="Pricing"
              title="Start free. Upgrade when the workload grows"
              description="The free plan is built to validate the workflow quickly. Pro adds the capacity and support teams need when Lexbot becomes part of everyday work."
            />

            <div className="pricing-grid">
              <PlanCard
                name="Free"
                price="€0"
                period="per month"
                summary="A simple way to test the workflow with no credit card required."
                features={[
                  '50 messages',
                  '100,000 upload tokens (≈75 pages)',
                  '5 minutes of transcription',
                  '5 OCR images',
                  'Create an account and get started right away',
                ]}
                ctaLabel="Create free account"
                ctaHref={SIGNUP_URL}
              />

              <PlanCard
                name="Pro"
                price="Monthly"
                period="billing"
                summary="More capacity, stronger privacy features, and direct support for teams using it every day."
                features={[
                  '10,000 messages per month',
                  '20,000,000 upload tokens (≈15,000 pages) per month',
                  '1,000 minutes of transcription per month',
                  '1,000 OCR images per month',
                  'PII pseudonymization and phone + email support (≤24h SLA)',
                ]}
                ctaLabel="See Pro in the app"
                ctaHref={SIGNUP_URL}
                featured
                footnote="The Pro rate is managed in-app so your checkout always reflects the current live price."
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
              <h2>Upload something real and see how quickly it becomes useful</h2>
              <p>
                The fastest way to evaluate the workflow is with one of your own files. Start free, ask a question, and see how the answer quality feels in practice.
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
            <p>Structured answers for noisy data.</p>
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

  useEffect(() => {
    document.title = isLegalPath
      ? legalPageMeta[pathname as LegalPathname]
      : 'Lexbot Pro | Structured answers for noisy data';
  }, [isLegalPath, pathname]);

  const page: ReactNode = isLegalPath ? (
    <Suspense fallback={<main className="legal-page legal-page--loading" />}>
      <LegalPage pathname={pathname as LegalPathname} />
    </Suspense>
  ) : (
    <HomePage />
  );

  return (
    <div className="site-root">
      <AppHeader />
      {page}
    </div>
  );
}
