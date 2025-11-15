Place your Cloudflare Origin Certificate files here if you are running nginx locally
without the GitHub Actions deploy pipeline.

In CI, the deploy workflow writes the Cloudflare Origin certificate and key from
GitHub secrets into this folder with the following names:

- lexbot.pro-origin.pem  (the certificate file, from CF_ORIGIN_CERT_LEXBOT_PRO)
- lexbot.pro-origin.key  (the private key file, from CF_ORIGIN_KEY_LEXBOT_PRO)

These files are mounted read-only to /etc/ssl/cf-origin/ inside the nginx container.
