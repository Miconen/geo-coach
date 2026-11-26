# OpenTofu with LeaseWeb and Cloudflare

Research for [#5](https://github.com/Miconen/geo-coach/issues/5). Checked 2026-11-21.

## Question

How can OpenTofu manage geo-coach's infrastructure, given an existing LeaseWeb VPS (not created by Tofu) and a subdomain whose DNS is on Cloudflare? Is there a maintained LeaseWeb provider and what does it cover? What should Tofu own, and what is better done by other tools? Where should Tofu state live, given that the repo is public?

## Answer

- **Tofu owns only the Cloudflare side**: the `A`/`AAAA` record for the subdomain (and later any Cloudflare settings we want, such as proxying). The VPS IP is a plain input variable.
- **Tofu does not manage the LeaseWeb VPS.** The official LeaseWeb provider is maintained and in the OpenTofu registry, but it has no resource for the VPS product, and no firewall resource.
- **The host is set up by a small idempotent script or Ansible playbook** (Docker, a deploy user, SSH hardening, host firewall). Cloud-init is not an option, because the box already exists.
- **Deploys are a GitHub Actions job** that SSHes in and runs `docker compose pull && docker compose up -d`. This is separate from Tofu.
- **State goes in a private Cloudflare R2 bucket**, through the `s3` backend with `use_lockfile = true`, and is also encrypted with OpenTofu's client-side state encryption (`pbkdf2` + `aes_gcm`, `enforced = true`). Secrets live only in GitHub Actions secrets.
- **Honest caveat**: with one DNS record in scope, Tofu is light on value. It pays off if the Cloudflare side grows (several records, proxy/TLS settings, R2 buckets for app data, Access rules). If it never grows, one manual DNS record is a fine alternative.

## Findings

### 1. LeaseWeb provider exists and is maintained, but does not cover VPS

- The provider is `leaseweb/leaseweb`, published by LeaseWeb at [github.com/LeaseWeb/terraform-provider-leaseweb](https://github.com/LeaseWeb/terraform-provider-leaseweb). It is not archived, the last push was 2026-11-20, and the latest release is v1.32.1 (2026-10-23).
- It is in the OpenTofu registry ([opentofu/registry `providers/l/leaseweb/leaseweb.json`](https://github.com/opentofu/registry/blob/main/providers/l/leaseweb/leaseweb.json) lists 1.32.1), so `source = "leaseweb/leaseweb"` resolves under Tofu.
- Auth is an API token (`token`, or the `LEASEWEB_TOKEN` env var) ([docs/index.md](https://github.com/LeaseWeb/terraform-provider-leaseweb/blob/main/docs/index.md)).
- **Resources** ([docs/resources](https://github.com/LeaseWeb/terraform-provider-leaseweb/tree/main/docs/resources)): `dedicated_server*`, `dns_resource_record_set` (LeaseWeb's own DNS), `ipmgmt_ip`, `ipmgmt_null_route`, `public_cloud_instance`, `public_cloud_image`, `public_cloud_ip`, `public_cloud_credential`, `public_cloud_instance_iso`, `public_cloud_load_balancer*`, `public_cloud_target_group`.
- **No VPS resource.** The LeaseWeb API exposes VPS as its own endpoint family, `/publicCloud/v1/vps/{vpsId}/...` (start/stop/reboot, reinstall, snapshots, IPs, credentials, ISO) ([LeaseWeb VPS API docs](https://developer.leaseweb.com/api-docs/vps_v1.html)). The provider has no `vps` code: the source tree at v1.32.1 has only `dedicatedserver`, `dns`, `ipmgmt` and `publiccloud` packages under `internal/provider`, and a code search for "vps" finds nothing in the Go code.
- `leaseweb_public_cloud_instance` is for Public Cloud instances (`lsw.*` instance types, `/publicCloud/v1/instances`). These are not the same as VPS, so a VPS cannot be imported into it. It also has many "changing this destroys and recreates" fields (`region`, `type`, `image.id`, `root_disk_storage_type`) ([public_cloud_instance.md](https://github.com/LeaseWeb/terraform-provider-leaseweb/blob/main/docs/resources/public_cloud_instance.md)). Even for an instance, importing a hand-made server risks Tofu wanting to replace it.
- **No firewall resource.** The API has security groups with firewall rules (`/publicCloud/v1/securityGroups/...`, attached via `/instances/{id}/attachSecurityGroups`), but only for Public Cloud instances, not `/vps` ([API docs](https://developer.leaseweb.com/api-docs/vps_v1.html)). The provider has no security-group resource. The LeaseWeb KB says VPS includes a free "Basic Firewall" ([KB: Overview of Leaseweb VPS](https://kb.leaseweb.com/?p=12417)), but I found no API endpoint for it, so it is portal-only.
- There is also an older, end-of-sale "Virtual Server" product under `/cloud/v2/virtualServers` ([API docs](https://developer.leaseweb.com/api-docs/virtualservers_v2.html), [KB end-of-sale notice](https://kb.leaseweb.com/kb/virtual-private-server/virtual-private-server-overview)). The provider has no resource for that either.

### 2. Cloudflare provider covers DNS well

- `cloudflare/cloudflare` is at v5.29.0 (2026-11-11) ([releases](https://github.com/cloudflare/terraform-provider-cloudflare/releases)).
- In v5 the DNS resource is `cloudflare_dns_record` (`zone_id`, `name`, `type`, `content`, `ttl`, `proxied`). It needs an API token with `DNS Read` + `DNS Write` ([dns_record.md](https://github.com/cloudflare/terraform-provider-cloudflare/blob/main/docs/resources/dns_record.md)). Scope the token to the one zone.
- If the record already exists, bring it under Tofu with an `import` block instead of recreating it.

### 3. State: R2 via the s3 backend, plus client-side encryption

- **R2 as backend**: Cloudflare documents using `backend "s3"` pointed at `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, with `region = "auto"`, `skip_credentials_validation`, `skip_metadata_api_check`, `skip_region_validation`, `skip_requesting_account_id`, `skip_s3_checksum` and `use_path_style = true` ([Cloudflare: Remote R2 backend](https://developers.cloudflare.com/terraform/advanced-topics/remote-backend/)). The OpenTofu s3 backend documents all of these options for S3-compatible endpoints ([OpenTofu s3 backend](https://opentofu.org/docs/language/settings/backends/s3/)).
- **Locking**: OpenTofu 1.10 added native S3 locking with `use_lockfile = true`, no DynamoDB needed ([What's new in 1.10](https://opentofu.org/docs/v1.10/intro/whats-new/)). It relies on conditional writes (`If-None-Match`), which R2 supports on `PutObject` ([R2 conditional operations](https://developers.cloudflare.com/r2/api/s3/conditional-operations/)). **Unverified**: Cloudflare's own example does not show `use_lockfile`, and I did not test it end to end against R2. Concurrent runs are unlikely here anyway, and a GitHub Actions `concurrency:` group gives a second guard.
- **Cost**: the R2 free tier is 10 GB-month storage, 1M Class A and 10M Class B operations per month ([R2 pricing](https://developers.cloudflare.com/r2/pricing/)). A state file is a few KB.
- **Encryption**: OpenTofu has had client-side state and plan encryption since 1.7 ([What's new in 1.7](https://opentofu.org/docs/v1.7/intro/whats-new/); [State and plan encryption](https://opentofu.org/docs/language/state/encryption/)). The key providers are `pbkdf2`, AWS KMS, GCP KMS, Azure Key Vault, OpenBao and `external`. The method is `aes_gcm`. A `pbkdf2` passphrase must be at least 16 characters. `enforced = true` refuses to write unencrypted state. Config can be supplied through the `TF_ENCRYPTION` env var instead of the code, and a `fallback` block handles migration and key rotation.
- **Why both**: the bucket is private, which stops the public from reading state. Encryption also means that a leaked R2 key, or someone browsing the bucket, does not expose the Cloudflare token or anything else in state. Plans should be encrypted too, or simply never uploaded as artifacts, because CI logs and artifacts on a public repo are public.
- Current versions: OpenTofu v1.13.9 (2026-11-05), `opentofu/setup-opentofu` v2.0.2 ([opentofu releases](https://github.com/opentofu/opentofu/releases), [setup-opentofu releases](https://github.com/opentofu/setup-opentofu/releases)).

### 4. Who owns what

| Concern | Tool | Why |
|---|---|---|
| Subdomain DNS record(s), Cloudflare proxy/TLS settings | OpenTofu (`cloudflare`) | Declarative, has a good provider, and needs no SSH |
| R2 state bucket | Manual, once (or a separate bootstrap root) | Avoids the chicken-and-egg problem of the backend creating itself |
| The VPS itself (size, OS, existence) | LeaseWeb portal, by hand | The provider has no VPS resource, and it is a single long-lived box |
| LeaseWeb "Basic Firewall" | Portal, by hand, if used at all | No API or provider support found |
| Docker install, deploy user, SSH keys/hardening, `ufw`/nftables, unattended upgrades | Idempotent bootstrap script or Ansible, run once and re-run on change | The box already exists, and cloud-init only runs at first boot |
| App rollout (Compose file, images, `.env`) | GitHub Actions job over SSH: `docker compose pull && up -d` | Fast, runs on every push, and does not need Tofu |

If the subdomain is proxied through Cloudflare, the host firewall can limit 80/443 to [Cloudflare's IP ranges](https://www.cloudflare.com/ips/). That rule belongs to the bootstrap script, not Tofu.

### 5. Secrets in a public repo

Keep these in GitHub Actions secrets only. Never commit them or put them in `*.tfvars`:

- `CLOUDFLARE_API_TOKEN` (one zone, DNS edit), read by the provider from the env.
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`: an R2 token scoped to the state bucket.
- `TF_ENCRYPTION`, or a passphrase variable that the encryption block reads.
- The SSH deploy key and host key, used for the deploy job.

Commit `.terraform.lock.hcl`. Gitignore `*.tfstate*`, `.terraform/`, `*.tfvars` and plan files. Run `tofu plan` on PRs only from same-repo branches, never on `pull_request_target` with fork code, because fork PRs on a public repo must not get the secrets.

## Sketch

```hcl
terraform {
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 5.29" }
  }
  backend "s3" {
    bucket                      = "geo-coach-tofu-state"
    key                         = "prod/terraform.tfstate"
    region                      = "auto"
    endpoints                   = { s3 = "https://<ACCOUNT_ID>.r2.cloudflarestorage.com" }
    use_path_style              = true
    use_lockfile                = true
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
  }
  encryption {
    key_provider "pbkdf2" "main" { passphrase = var.state_passphrase }
    method "aes_gcm" "main" { keys = key_provider.pbkdf2.main }
    state {
      method   = method.aes_gcm.main
      enforced = true
    }
    plan {
      method   = method.aes_gcm.main
      enforced = true
    }
  }
}

variable "vps_ipv4" { type = string }

resource "cloudflare_dns_record" "app" {
  zone_id = var.zone_id
  name    = "geo"            # the subdomain
  type    = "A"
  content = var.vps_ipv4
  ttl     = 1                # automatic
  proxied = true
}
```

Not run. The `var.state_passphrase` used inside `encryption` needs a variable that is set at init time (from the env via `TF_VAR_state_passphrase`). Check the [encryption docs](https://opentofu.org/docs/language/state/encryption/) on how variables may be referenced there, or use `TF_ENCRYPTION` instead.

## Unverified / open

- Which LeaseWeb product the box actually is: the new VPS (`/publicCloud/v1/vps`) or the old Virtual Server (`/cloud/v2`). Neither changes the recommendation, because the provider covers neither.
- `use_lockfile` against R2 has not been tested end to end (see above).
- The provider CHANGELOG for 1.32.0 lists object storage resources, but no object storage code or docs are in the v1.32.1 tree. This is irrelevant to us, but it does mean the changelog is not fully reliable.
- Whether LeaseWeb VPS "Basic Firewall" has an API was not confirmed either way beyond searching the API reference.
