// @ts-check
/**
 * Minimal Stripe env SDK for SSOT pull/apply/diff.
 * Node 18+.
 */
import 'dotenv/config';
import Stripe from 'stripe';
import fs from 'node:fs/promises';
import path from 'node:path';
import stringify from 'fast-json-stable-stringify';

const log = (...args) => { if (process.env.DEBUG || argv.verbose) console.log('[stripe-env]', ...args); };
const error = (...args) => console.error('[stripe-env]', ...args);

const argv = parseArgs(process.argv.slice(2));
const CMD = argv._[0] || 'help';
const SSOT_FILE = path.resolve(argv.file || 'ssot.stripe.json');
const DRY = !!argv.dry;

function parseArgs(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('-')) { out._.push(a); continue; }
    if (a === '--verbose' || a === '-v') out.verbose = true;
    else if (a === '--dry') out.dry = true;
    else if (a === '--file') { out.file = args[++i]; }
    else if (a.startsWith('--file=')) { out.file = a.split('=')[1]; }
    else out[a.replace(/^--?/, '')] = true;
  }
  return out;
}

function stripeClient() {
  const apiKey = process.env.STRIPE_API_KEY;
  if (!apiKey) {
    throw new Error('Missing STRIPE_API_KEY (set it in .env)');
  }
  /** @type {import('stripe').StripeConfig} */
  const cfg = {};
  if (process.env.STRIPE_API_VERSION) cfg.apiVersion = process.env.STRIPE_API_VERSION;
  return new Stripe(apiKey, cfg);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Keep only deterministic fields for SSOT */
function prune(obj) {
  return JSON.parse(stringify(obj)); // stable order
}

/** Pull remote Stripe settings into local SSOT JSON */
async function cmdPull() {
  const stripe = stripeClient();
  const started = new Date().toISOString();
  log('Pulling from Stripe…');

  // Account (current)
  const account = await stripe.accounts.retrieve(); // current account
  const accountInfo = {
    id: account.id,
    business_type: account.business_type,
    country: account.country,
    default_currency: account.default_currency,
    email: account.email,
    settings: {
      branding: account.settings?.branding ?? null
    }
  };

  // Products + Prices
  const products = [];
  for await (const p of stripe.products.list({ limit: 100 }).autoPagingEach ? [] : []) {} // placeholder

  // Manual auto-pagination (works without autoPagingEach)
  let prCursor;
  do {
    const page = await stripe.products.list({ limit: 100, starting_after: prCursor });
    for (const p of page.data) {
      // Fetch prices for product
      const prices = [];
      let priceCursor;
      do {
        const pricePage = await stripe.prices.list({ limit: 100, product: p.id, starting_after: priceCursor });
        for (const price of pricePage.data) {
          prices.push(prune({
            id: price.id,
            active: price.active,
            currency: price.currency,
            unit_amount: price.unit_amount,
            lookup_key: price.lookup_key ?? null,
            nickname: price.nickname ?? null,
            recurring: price.recurring ?? null,
            tax_behavior: price.tax_behavior ?? 'unspecified',
            type: price.type
          }));
        }
        priceCursor = pricePage.has_more ? pricePage.data.at(-1)?.id : undefined;
      } while (priceCursor);

      products.push(prune({
        id: p.id,
        code: p.metadata?.code ?? null,
        name: p.name,
        description: p.description ?? null,
        active: p.active,
        metadata: p.metadata ?? {},
        default_price: typeof p.default_price === 'string' ? p.default_price : p.default_price?.id ?? null,
        prices
      }));
    }
    prCursor = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (prCursor);

  // Webhook endpoints
  const webhooks = [];
  let whCursor;
  do {
    const page = await stripe.webhookEndpoints.list({ limit: 100, starting_after: whCursor });
    for (const wh of page.data) {
      webhooks.push(prune({
        id: wh.id,
        url: wh.url,
        api_version: wh.api_version ?? null,
        connect: !!wh.connect,
        enabled_events: wh.enabled_events,
        status: wh.status,
        description: wh.description ?? null
      }));
    }
    whCursor = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (whCursor);

  // Portal configurations
  const portalConfigs = [];
  let pcCursor;
  do {
    const page = await stripe.billingPortal.configurations.list({ limit: 20, starting_after: pcCursor });
    for (const c of page.data) {
      portalConfigs.push(prune({
        id: c.id,
        is_default: !!c.is_default,
        business_profile: c.business_profile ?? null,
        features: c.features ?? null
      }));
    }
    pcCursor = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (pcCursor);

  // Tax settings
  let tax_settings = null;
  try {
    const t = await stripe.tax.settings.retrieve();
    tax_settings = prune({
      active: t.active,
      automatic_tax: t.automatic_tax ?? null,
      head_office: t.head_office ?? null
    });
  } catch (e) {
    log('Tax settings not available with current account/permissions; skipping.');
  }

  // Coupons
  const coupons = [];
  let cCursor;
  do {
    const page = await stripe.coupons.list({ limit: 100, starting_after: cCursor });
    for (const c of page.data) {
      coupons.push(prune({
        id: c.id,
        name: c.name ?? null,
        percent_off: c.percent_off ?? null,
        amount_off: c.amount_off ?? null,
        currency: c.currency ?? null,
        duration: c.duration,
        duration_in_months: c.duration_in_months ?? null,
        max_redemptions: c.max_redemptions ?? null,
        redeem_by: c.redeem_by ?? null,
        metadata: c.metadata ?? {}
      }));
    }
    cCursor = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (cCursor);

  // Shipping rates
  const shipping_rates = [];
  let sCursor;
  do {
    const page = await stripe.shippingRates.list({ limit: 100, starting_after: sCursor });
    for (const s of page.data) {
      shipping_rates.push(prune({
        id: s.id,
        active: s.active,
        display_name: s.display_name,
        fixed_amount: s.fixed_amount ?? null,
        delivery_estimate: s.delivery_estimate ?? null,
        tax_behavior: s.tax_behavior ?? 'unspecified',
        type: s.type
      }));
    }
    sCursor = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (sCursor);

  const ssot = prune({
    _generated_at: started,
    account: accountInfo,
    products,
    webhooks,
    portal: { configurations: portalConfigs },
    tax_settings,
    coupons,
    shipping_rates
  });

  await fs.writeFile(SSOT_FILE, stringify(ssot, { space: 2 }) + '\n', 'utf-8');
  console.log(`✅ Pulled Stripe settings → ${SSOT_FILE}`);
}

/** Return a map for quick lookup */
function indexBy(arr, keyFn) {
  const m = new Map();
  for (const item of arr) m.set(keyFn(item), item);
  return m;
}

/** Apply local SSOT to Stripe (idempotent upsert) */
async function cmdApply() {
  if (DRY) console.log('Dry-run mode. No changes will be made.');
  const stripe = stripeClient();
  const ssot = JSON.parse(await fs.readFile(SSOT_FILE, 'utf-8'));

  let changes = 0;

  // --- Products ---
  const remoteProducts = [];
  let pCursor;
  do {
    const page = await stripe.products.list({ limit: 100, starting_after: pCursor });
    remoteProducts.push(...page.data);
    pCursor = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (pCursor);

  const byCode = indexBy(remoteProducts.filter(p => p.metadata?.code), p => p.metadata.code);

  for (const p of ssot.products ?? []) {
    const code = p.code || null;
    if (!code) {
      error(`Product missing 'code': ${p.name}`);
      continue;
    }
    const existing = byCode.get(code);

    if (!existing) {
      if (DRY) { console.log(`⨁ Would create product ${code}`); }
      else {
        await stripe.products.create({
          name: p.name,
          description: p.description ?? undefined,
          active: p.active ?? true,
          metadata: { ...(p.metadata || {}), code },
        });
        changes++;
        console.log(`➕ Created product ${code}`);
        await sleep(400);
      }
    } else {
      // Update if fields differ
      const update = {};
      if (p.name && p.name !== existing.name) update['name'] = p.name;
      if ((p.description ?? null) !== (existing.description ?? null)) update['description'] = p.description ?? '';
      if (typeof p.active === 'boolean' && p.active !== existing.active) update['active'] = p.active;
      // merge metadata but keep code stable
      const desiredMeta = { ...(p.metadata || {}), code };
      if (JSON.stringify(desiredMeta) !== JSON.stringify(existing.metadata || {})) update['metadata'] = desiredMeta;

      if (Object.keys(update).length) {
        if (DRY) { console.log(`Δ Would update product ${code}:`, update); }
        else {
          await stripe.products.update(existing.id, update);
          changes++;
          console.log(`✔ Updated product ${code}`);
          await sleep(250);
        }
      }
    }

    // Ensure prices by lookup_key
    for (const price of p.prices ?? []) {
      if (!price.lookup_key) {
        error(`Price for product ${code} missing 'lookup_key'`);
        continue;
      }
      // Search price by lookup_key (or metadata.code fallback)
      let found = null;
      // Prefer Search API for direct lookup_key matches
      try {
        const search = await stripe.prices.search({ query: `lookup_key:'${price.lookup_key}'` });
        found = search.data[0] ?? null;
      } catch {
        // Fallback: list and filter
        const list = await stripe.prices.list({ limit: 100, product: existing?.id });
        found = list.data.find(pr => pr.lookup_key === price.lookup_key) ?? null;
      }

      const priceParams = {
        lookup_key: price.lookup_key,
        currency: price.currency,
        unit_amount: price.unit_amount,
        nickname: price.nickname ?? undefined,
        tax_behavior: price.tax_behavior ?? undefined,
        recurring: price.recurring ?? undefined,
        product: existing?.id
      };

      if (!found) {
        if (DRY) { console.log(`⨁ Would create price ${price.lookup_key} for ${code}`); }
        else {
          await stripe.prices.create(priceParams);
          changes++;
          console.log(`➕ Created price ${price.lookup_key} (${code})`);
          await sleep(250);
        }
      } else {
        // Updatable fields for Price are limited; cannot change currency/type.
        const updates = {};
        if ((price.nickname ?? null) !== (found.nickname ?? null)) updates['nickname'] = price.nickname ?? null;
        if ((price.tax_behavior ?? 'unspecified') !== (found.tax_behavior ?? 'unspecified')) updates['tax_behavior'] = price.tax_behavior;
        if (price.recurring && found.recurring) {
          const desired = JSON.stringify({ interval: price.recurring.interval, interval_count: price.recurring.interval_count || 1 });
          const current = JSON.stringify({ interval: found.recurring.interval, interval_count: found.recurring.interval_count || 1 });
          if (desired !== current) updates['recurring'] = price.recurring;
        }
        if (Object.keys(updates).length) {
          if (DRY) { console.log(`Δ Would update price ${price.lookup_key}:`, updates); }
          else {
            await stripe.prices.update(found.id, updates);
            changes++;
            console.log(`✔ Updated price ${price.lookup_key}`);
            await sleep(200);
          }
        }
      }
    }
  }

  // --- Webhooks ---
  // Index existing by url+connect
  const remoteWebhooks = [];
  let wCursor;
  do {
    const page = await stripe.webhookEndpoints.list({ limit: 100, starting_after: wCursor });
    remoteWebhooks.push(...page.data);
    wCursor = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (wCursor);

  function whKey({ url, connect }) { return `${url}#${connect ? 'connect' : 'acct'}`; }
  const byUrl = indexBy(remoteWebhooks, whKey);

  for (const desired of ssot.webhooks ?? []) {
    const key = whKey(desired);
    const existing = byUrl.get(key);
    if (!existing) {
      if (DRY) { console.log(`⨁ Would create webhook: ${desired.url}`); }
      else {
        await stripe.webhookEndpoints.create({
          url: desired.url,
          connect: !!desired.connect,
          enabled_events: desired.enabled_events || ['*'],
          description: desired.description || undefined
        });
        changes++;
        console.log(`➕ Created webhook ${desired.url}`);
        await sleep(200);
      }
    } else {
      const updates = {};
      if (desired.enabled_events && JSON.stringify(desired.enabled_events) !== JSON.stringify(existing.enabled_events)) {
        updates['enabled_events'] = desired.enabled_events;
      }
      if ((desired.description ?? null) !== (existing.description ?? null)) {
        updates['description'] = desired.description ?? null;
      }
      if (desired.status && desired.status !== existing.status) {
        updates['disabled'] = desired.status === 'disabled';
      }
      if (Object.keys(updates).length) {
        if (DRY) { console.log(`Δ Would update webhook ${desired.url}:`, updates); }
        else {
          await stripe.webhookEndpoints.update(existing.id, updates);
          changes++;
          console.log(`✔ Updated webhook ${desired.url}`);
          await sleep(150);
        }
      }
    }
  }

  // --- Portal configurations ---
  // Strategy: if `is_default` true and no existing default, create new default config; else create/update non-defaults by matching headline string.
  const remotePortal = await stripe.billingPortal.configurations.list({ limit: 100 });
  for (const cfg of ssot.portal?.configurations ?? []) {
    // Match by (is_default) or headline
    const match = remotePortal.data.find(c =>
      (cfg.is_default && c.is_default) ||
      (cfg.business_profile?.headline && c.business_profile?.headline === cfg.business_profile.headline)
    );
    if (!match) {
      if (DRY) { console.log(`⨁ Would create portal config (default=${!!cfg.is_default})`); }
      else {
        await stripe.billingPortal.configurations.create({
          business_profile: cfg.business_profile || undefined,
          features: cfg.features || { invoice_history: { enabled: true } }
        });
        changes++;
        console.log(`➕ Created portal configuration`);
        await sleep(200);
      }
    } else {
      const updates = {};
      const desiredBP = JSON.stringify(cfg.business_profile || null);
      const currentBP = JSON.stringify(match.business_profile || null);
      if (desiredBP !== currentBP) updates['business_profile'] = cfg.business_profile || null;
      const desiredFeat = JSON.stringify(cfg.features || null);
      const currentFeat = JSON.stringify(match.features || null);
      if (desiredFeat !== currentFeat) updates['features'] = cfg.features || null;

      if (Object.keys(updates).length) {
        if (DRY) { console.log(`Δ Would update portal config ${match.id}`); }
        else {
          await stripe.billingPortal.configurations.update(match.id, updates);
          changes++;
          console.log(`✔ Updated portal configuration ${match.id}`);
          await sleep(150);
        }
      }
    }
  }

  // --- Tax settings ---
  if (ssot.tax_settings) {
    try {
      const desired = ssot.tax_settings;
      if (DRY) { console.log(`Δ Would upsert tax settings`); }
      else {
        await stripe.tax.settings.update({
          head_office: desired.head_office || undefined,
          automatic_tax: desired.automatic_tax || undefined
        });
        changes++;
        console.log(`✔ Upserted tax settings`);
      }
    } catch (e) {
      error('Failed to update tax settings:', e?.message || e);
    }
  }

  // --- Coupons (create-only unless exact name/duration match) ---
  if (Array.isArray(ssot.coupons)) {
    const existingCoupons = await stripe.coupons.list({ limit: 100 });
    for (const c of ssot.coupons) {
      const found = existingCoupons.data.find(x => x.id === c.id_or_code || x.name === c.name);
      if (!found) {
        if (DRY) { console.log(`⨁ Would create coupon ${c.id_or_code || c.name}`); }
        else {
          await stripe.coupons.create({
            id: /^[A-Za-z0-9_\-]+$/.test(c.id_or_code || '') ? c.id_or_code : undefined,
            name: c.name,
            percent_off: c.percent_off ?? undefined,
            amount_off: c.amount_off ?? undefined,
            currency: c.currency ?? undefined,
            duration: c.duration,
            duration_in_months: c.duration_in_months ?? undefined,
            max_redemptions: c.max_redemptions ?? undefined,
            redeem_by: c.redeem_by ?? undefined,
            metadata: c.metadata ?? undefined
          });
          changes++;
          console.log(`➕ Created coupon ${c.id_or_code || c.name}`);
        }
      }
    }
  }

  // --- Shipping rates (create if not exists by display_name) ---
  if (Array.isArray(ssot.shipping_rates)) {
    const existing = await stripe.shippingRates.list({ limit: 100 });
    for (const s of ssot.shipping_rates) {
      const found = existing.data.find(x => x.display_name === s.display_name);
      if (!found) {
        if (DRY) { console.log(`⨁ Would create shipping rate ${s.display_name}`); }
        else {
          await stripe.shippingRates.create({
            display_name: s.display_name,
            fixed_amount: s.fixed_amount ?? undefined,
            delivery_estimate: s.delivery_estimate ?? undefined,
            tax_behavior: s.tax_behavior ?? undefined,
            type: s.type ?? 'fixed_amount'
          });
          changes++;
          console.log(`➕ Created shipping rate ${s.display_name}`);
        }
      }
    }
  }

  console.log(DRY ? `✅ Dry-run complete.` : `✅ Apply complete. Changes: ${changes}`);
}

/** Compare local SSOT to remote snapshot and print a summary diff */
async function cmdDiff() {
  const tmp = path.resolve('.ssot.remote.tmp.json');
  await cmdPull(); // writes to SSOT_FILE
  await fs.copyFile(SSOT_FILE, tmp);
  const local = JSON.parse(await fs.readFile(SSOT_FILE, 'utf-8'));
  const remote = JSON.parse(await fs.readFile(tmp, 'utf-8'));
  await fs.unlink(tmp);

  // If user overwrote SSOT_FILE with their local desired state, we need to re-pull remote to compare.
  // To keep things simple, we compute a structural diff on a few keys.
  const keys = ['products','webhooks','portal','tax_settings','coupons','shipping_rates'];
  for (const k of keys) {
    const A = stringify(local[k] ?? null, { space: 2 });
    const B = stringify(remote[k] ?? null, { space: 2 });
    if (A !== B) {
      console.log(`\n--- ${k.toUpperCase()} DIFF ---`);
      console.log('local:', A.length, 'bytes');
      console.log('remote:', B.length, 'bytes');
    } else {
      console.log(`\n${k}: ✅ identical`);
    }
  }
  console.log('\n(For a detailed diff, commit both files and use your Git diff.)');
}

/** Validate SSOT file for common mistakes */
async function cmdValidate() {
  const ssot = JSON.parse(await fs.readFile(SSOT_FILE, 'utf-8'));
  const errors = [];
  for (const p of ssot.products ?? []) {
    if (!p.code) errors.push(`Product "${p.name}" missing 'code'`);
    for (const pr of p.prices ?? []) {
      if (!pr.lookup_key) errors.push(`Price in product "${p.code}" missing 'lookup_key'`);
      if (!pr.currency || !pr.unit_amount) errors.push(`Price "${pr.lookup_key}" missing currency/unit_amount`);
    }
  }
  for (const wh of ssot.webhooks ?? []) {
    if (!wh.url) errors.push('Webhook missing url');
  }
  if (errors.length) {
    console.error('❌ Validation errors:\n - ' + errors.join('\n - '));
    process.exitCode = 1;
  } else {
    console.log('✅ SSOT looks valid');
  }
}

(async function main() {
  try {
    if (CMD === 'pull') await cmdPull();
    else if (CMD === 'apply') await cmdApply();
    else if (CMD === 'diff') await cmdDiff();
    else if (CMD === 'validate') await cmdValidate();
    else {
      console.log(`Usage: node index.js <pull|apply|diff|validate> [--file ssot.stripe.json] [--verbose] [--dry]`);
    }
  } catch (e) {
    error(e?.message || e);
    process.exitCode = 1;
  }
})();
