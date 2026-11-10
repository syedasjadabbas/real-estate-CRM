# VoIP / browser calling: integration boundary and provider evaluation (Pakistan)

Status: **foundation only. No provider is chosen, configured or implemented.** The CRM never fakes a call, a call status, a duration or a connection. With nothing configured, the lead page says *"Browser calling isn't set up yet."* and offers the phone's own dialer (`tel:` link), as before.

Research date for every external fact below: **2026-11-10**. Anything marked **to verify** could not be confirmed on an official page and must be confirmed in writing with the provider or operator before committing.

## 1. What exists in the code

| Piece | File | Notes |
|---|---|---|
| Client-safe types and labels | `src/modules/voip/types.ts` | Zod-free and server-free. The Dialer imports it; Zod probes `new Function`, which the CSP reports. |
| Provider interface | `src/modules/voip/provider.ts` | `VoipProvider`: `id`, `name`, `requiredEnv`, `capabilities`, `isConfigured(env)`, `unavailableReason(env)`, `createClientSession(actor, env)`, `verifyWebhook(req, env)`. |
| Placeholders | `src/modules/voip/providers.ts` | One typed placeholder each for twilio, vonage, plivo, telnyx and sip. Each always reports `isConfigured() === false`, refuses sessions and rejects every webhook. |
| Registry and status | `src/modules/voip/registry.ts` | Reads `VOIP_PROVIDER` (unset, empty or `none` means no provider). `voipStatus(env)` returns `{ configured: false, reason, provider, providerName }` or `{ configured: true, provider, providerName }`. It never returns secrets. |
| Service | `src/modules/voip/service.ts` | `getVoipStatus(actor)` requires lead `view` access (super admin, admin, manager, agent). |
| API | `GET /api/v1/voip/status` | Returns `{ data: VoipStatus }`. HR and accountant get 403. |
| UI | `src/features/voip/components/dialer.tsx` | The "Browser calling" region on the lead page, below the facts card. |
| Tests | `tests/unit/voip-rules.test.ts`, `e2e/voip-dialer.spec.ts` | |

`reason` is one of the following:
- `not_selected`: no provider is set.
- `unknown_provider`: `VOIP_PROVIDER` holds an unrecognised value. The raw value is never echoed.
- `adapter_not_implemented`: the provider is known, but no adapter has been built (true of every provider today).
- `missing_config`: reserved for real adapters that are missing credentials.

### Rules for whoever builds the real adapter

1. **Replace one placeholder in `providers.ts` with a real adapter.**
   - `isConfigured` may return true only when the adapter is implemented and every required env var is present.
2. **Add `POST /api/v1/voip/session`, which calls `createClientSession`.**
   - It mints a short-lived, per-user token (or SIP credentials) after checking lead access.
   - Use an identity like `user_<uuid>`, never an email address.
   - Keep the provider's master secrets on the server only.
3. **Add a webhook route.**
   - Read the raw body and call `verifyWebhook`, which checks the provider signature.
   - Write call facts (status, duration, recording URL) only from verified events.
   - Webhook routes are not signed-in user routes, so they need their own handler rather than `apiRoute`. They also need a same-origin exemption.
4. **Mount the provider's browser SDK in the Dialer's `[data-voip-mount]` element.**
   - Load it client-side only.
   - Show states only as the SDK or webhooks report them.
5. **Do not count browser calls in Performance until the client defines a call (decision C-19).**
   - Storing call events is fine; scoring them is not.
6. **Microphone permission:**
   - The app sends no `Permissions-Policy` header today, so `getUserMedia` works on HTTPS.
   - If a `Permissions-Policy` is added later, it must allow `microphone=(self)`.
   - Browsers require a secure context, so production must run on HTTPS (localhost is exempt).

## 2. Provider evaluation

### 2.1 Twilio Voice (Voice JavaScript SDK)

- **Browser:**
  - Mature WebRTC SDK with access tokens and TwiML apps.
  - Signaling over WSS/HTTPS 443 to `voice-js.roaming.twilio.com`, `chunderw-vpc-gll*.twilio.com` and edge hosts `voice-js.{edge}.twilio.com`.
  - Sound assets come from `sdk.twilio.com`; insights go to `eventgw*.twilio.com`.
  - Media uses UDP 10000–60000 to 168.86.128.0/18.
  - Source: [Twilio network connectivity requirements](https://www.twilio.com/docs/voice/sdks/network-connectivity-requirements) (read 2026-11-10).
- **Pakistan numbers:**
  - Twilio says it does not have voice-enabled numbers for Pakistan. Outbound calls must use a caller ID from another country.
  - Source: [Twilio SIP trunking pricing, Pakistan](https://www.twilio.com/en-us/sip-trunking/pricing/pk) (read 2026-11-10).
  - Whether a foreign caller ID is delivered to Pakistani handsets or replaced: **to verify**.
- **Recording:**
  - Recordings are stored at Twilio, or in external storage you configure.
  - Downloads need authentication; dual-channel is the default and encryption is optional.
  - Source: [Twilio Recording resource](https://www.twilio.com/docs/voice/api/recording) (read 2026-11-10).
- **Cost (per minute, outbound):**
  - Pakistan mobile USD 0.1800/min; Pakistan USD 0.1550/min.
    - Source: [Twilio Voice pricing, Pakistan](https://www.twilio.com/en-us/voice/pricing/pk) (read 2026-11-10).
  - SIP-trunk termination to Pakistan mobile USD 0.1760/min.
    - Source: [Twilio SIP trunking pricing, Pakistan](https://www.twilio.com/en-us/sip-trunking/pricing/pk) (read 2026-11-10).
  - Per-minute charge for the browser (client) leg: **to verify**.
- **Effort:** Low. Best documentation of the group. The main risk is caller-ID delivery to Pakistan.

### 2.2 Vonage (Voice API and Client SDK)

- **Browser:**
  - The legacy Client SDK defaults to `https://api.nexmo.com` and `wss://ws.nexmo.com`, with regional hosts like `wss://ws-us-3.vonage.com`.
    - Source: [Vonage configure data center](https://developer.vonage.com/ja/legacy-client-sdk/configuration/configure-data-center) (read 2026-11-10).
  - Vonage IP ranges include 216.147.0.0/18.
    - Source: [Vonage IP allow-list](https://api.support.vonage.com/hc/en-us/articles/16567926552860-Which-IP-addresses-should-I-allow-for-the-Vonage-API-services) (read 2026-11-10).
  - Hosts for the current, non-legacy SDK: **to verify**.
- **Pakistan:** Number availability, caller-ID handling and restrictions are all **to verify**.
- **Recording:**
  - The `record` action posts a `recording_url` to your event webhook; you fetch it with an authenticated GET.
  - Files are deleted after 30 days. Default format is MP3.
  - Sources: [Vonage recording concepts](https://developer.vonage.com/en/voice/voice-api/concepts/recording) and [Vonage retrieving recordings](https://api.support.vonage.com/hc/en-us/articles/235558087-How-do-I-retrieve-my-Voice-API-recordings) (read 2026-11-10).
- **Cost:** **to verify**. The [Vonage voice pricing page](https://www.vonage.com/communications-apis/voice/pricing/) could not be read (HTTP 403).
- **Effort:** Medium. The SDK generation changed recently, and some docs are marked legacy.

### 2.3 Plivo (Browser SDK)

- **Browser:**
  - Connects to `client.plivo.com`, `client-fb.plivo.com` (fallback) and `insights.plivo.com`, with no static IPs published.
  - STUN: `stun.plivo.com:3478` and `stun-fb.plivo.com:3478`.
  - RTP: UDP 10000–30000.
  - The WebSocket port is not stated (**to verify**).
  - Source: [Plivo firewall configuration](https://docs.plivo.com/docs/voice/concepts/firewall-network-configuration) (read 2026-11-10).
- **Pakistan numbers:**
  - Plivo's Pakistan page lists inbound as "Not Supported", so there are no Pakistani numbers.
    - Source: [Plivo voice pricing, Pakistan](https://www.plivo.com/voice/pricing/pk/) (read 2026-11-10).
  - The caller ID must be a Plivo number or a verified number. Outside US, CA, UK, AU and PE, caller-ID delivery is best-effort.
    - Source: [Plivo verified caller ID](https://plivo.com/docs/voice/concepts/verified-caller-id) (read 2026-11-10).
- **Recording:**
  - Free storage for 90 days, then USD 0.0004/min/month. Auto-delete is optional. Download via `recording_url`.
  - Sources: [Plivo download recordings](https://docs.plivo.com/docs/voice/use-cases/download-recordings) and [Plivo recording storage charges](https://old-support.plivo.com/hc/en-us/articles/20049354718361-How-can-I-manage-the-recording-storage-charges) (read 2026-11-10).
- **Cost:**
  - Outbound to Pakistan mobile USD 0.1410/min; browser SDK leg USD 0.0033/min.
  - Source: [Plivo voice pricing, Pakistan](https://www.plivo.com/voice/pricing/pk/) (read 2026-11-10).
- **Effort:** Low to medium.

### 2.4 Telnyx (WebRTC JS SDK)

- **Browser:**
  - Signaling: `wss://rtc.telnyx.com:443`.
  - STUN: `stun.telnyx.com:3478`.
  - TURN: `turn.telnyx.com:3478` (UDP/TCP) and `turn2.telnyx.com:443` (TLS).
  - Media uses dynamic IPs.
  - Source: [Telnyx firewall configuration](https://developers.telnyx.com/development/webrtc/js-sdk/how-to/configure-network-firewall) (read 2026-11-10).
- **Pakistan:** Number availability, caller-ID handling and restrictions are all **to verify**.
- **Recording:**
  - Stored in Telnyx's S3 by default. The `call.recording.saved` webhook link expires after 10 minutes.
  - Recordings can go to your own S3, GCS or Azure storage instead, which is good for data control.
  - Source: [Telnyx storing call recordings](https://developers.telnyx.com/docs/voice/programmable-voice/storing-call-recordings) (read 2026-11-10).
- **Cost:**
  - Browser/app calling USD 0.002/min.
    - Source: [Telnyx call control pricing, Pakistan](https://telnyx.com/pricing/call-control/pk) (read 2026-11-10).
  - Outbound rate to Pakistan mobile: **to verify** (global price sheet or `GET /v2/public/pricing`).
- **Effort:** Medium.

### 2.5 Self-hosted SIP: Asterisk or FreeSWITCH, a Pakistani SIP trunk, and SIP.js or JsSIP

- **Browser:**
  - SIP.js or JsSIP over `wss://` to the client's own PBX.
  - Needs the client's own STUN/TURN server (for example coturn) for agents behind NAT or mobile data.
  - The CSP only needs the client's own hosts.
- **Pakistan numbers:**
  - This is the only route that can present a real Pakistani caller ID: a SIP trunk or PRI from a licensed operator (PTCL, Nayatel, Wateen, Jazz or Zong business).
  - No official SIP-trunk product page was found for any of them. Availability, number blocks, caller-ID rules and contract terms are **to verify** by operator quote.
  - PTA requires commercial voice traffic to use IP addresses whitelisted through the ISP; unregistered IPs face degradation.
    - Source: [PTA IP whitelisting to curb grey telephony](https://pta.gov.pk/category/pta-for-ip-whitelisting-to-curb-grey-telephony-127606654-2023-06-01) (read 2026-11-10).
- **Recording:**
  - Recorded on the PBX (MixMonitor or equivalent). Storage stays fully in the client's control.
  - Recordings can feed the existing private recording storage.
- **Cost:**
  - Operator line rental and per-minute rates: **to verify** (quote needed).
  - Plus a server (VPS or on-premises), TLS certificates and TURN bandwidth.
- **Effort:** High. It means running a PBX, TLS, TURN, NAT traversal, monitoring, security hardening and toll-fraud protection, plus an operator contract.

## 3. PTA and regulatory points to verify (all options)

- **Grey traffic:**
  - PTA treats illegal gateways and IPs that route international voice as grey traffic and enforces through raids and IP blocking.
    - Source: [PTA blocks 200,000 IPs](https://www.pta.gov.pk/en/media-center/single-media/-pta-blocks-200000-ip-addreses-to-control-grey-traffic) (read 2026-11-10).
  - The client must never use a "cheap local termination" reseller that routes through SIM boxes.
- **LDI licensing:**
  - International voice must reach Pakistan through licensed LDI operators.
  - PTA's consultation paper states that all voice calls, including VoIP, are routed through licensed channels. The text read was partial.
    - Sources: [PTA LDI consultation paper](https://pta.gov.pk/assets/media/cons_paper_ldi_lic_020817.pdf) and [LDI licence template, July 2025](https://www.pta.gov.pk/assets/media/2025-07-18-Approved-LDI-License-Template-for-Pakistan.pdf) (read 2026-11-10).
  - Practical effect for a cloud provider: calls arrive as international traffic, and the caller ID may show as international or be replaced. **To verify** in writing with the chosen provider.
- **Class licences:**
  - PTA's Class licence for voice services is shown as suspended "till further notice".
    - Source: [PTA Class VAS licences](https://pta.gov.pk/category/class-vas-licenses-588174-2023-05-30) (read 2026-11-10).
  - A March 2026 consultation on a draft voice Class licence exists but was not reviewed.
    - Source: [PTA draft voice Class licence consultation](https://www.pta.gov.pk/assets/media/2026-03-03-Consultation-paper-for-Draft-template-of-Voice-Class-License-for-PPS-PRS-TRS.pdf).
  - Whether a CRM placing outbound sales calls through a licensed operator needs any licence of its own: **to verify** with counsel.
- **Call recording and consent:**
  - No PTA rule specific to businesses recording their own calls was found (**to verify**).
  - Recommended: announce recording at the start of each call, or obtain consent, and restrict playback as the CRM already does.
  - The Telecom Consumers Protection Regulations cover confidentiality of user data; the final text was not reviewed (**to verify**).
- **Data protection:**
  - The Personal Data Protection Bill was reported as still not enacted as of October 2026.
    - Source: [Express Tribune, Oct 2026](https://tribune.com.pk/story/2625470/pakistan-can-no-longer-wait-for-personal-data-protection-law) (news, not official; **to verify**).
  - Recordings held abroad by a cloud provider should be reviewed against whatever is enacted.

## 4. Changes needed when a provider is chosen

### CSP (`next.config.ts`): change only when the adapter ships, not now

The current policy is `connect-src 'self'` and `media-src 'self' blob:`. A real provider needs its hosts added to `connect-src`, and `script-src` too unless the SDK is bundled from npm (preferred: bundle it, add no third-party script origins).

| Provider | `connect-src` additions |
|---|---|
| Twilio | `wss://*.twilio.com https://*.twilio.com`, or the explicit hosts in §2.1 |
| Vonage | `https://api.nexmo.com wss://ws.nexmo.com wss://*.vonage.com https://*.vonage.com` (to verify for the current SDK) |
| Plivo | `wss://client.plivo.com wss://client-fb.plivo.com https://insights.plivo.com` (scheme and port to verify) |
| Telnyx | `wss://rtc.telnyx.com` |
| Self-hosted | `wss://<client's PBX host>` |

Notes:
- STUN/TURN and RTP media traffic is not governed by CSP `connect-src`. Corporate firewalls must allow the UDP ranges listed per provider.
- Remote audio is played from a `MediaStream` (`srcObject`), which needs no `media-src` change.
- If the provider's ringtone or sound assets load by URL (Twilio's `sdk.twilio.com`), add that host to `media-src` or bundle the sounds.
- Webhook routes live under `/api/`, where the page CSP is not applied.

### Recording-storage decisions for the client

1. **Where recordings live:**
   - Option A: keep them at the provider, with their retention: Vonage 30 days; Plivo 90 days free, then paid; Twilio until deleted.
   - Option B: copy each into the CRM's private storage (`FILE_STORAGE_DIR`, see `docs/FILE_STORAGE_REVIEW.md`) and delete it at the provider.
   - Option B keeps one place for playback and access control. It reuses the authenticated `/api/v1/recordings/:id` streaming, but needs disk, backup and retention planning.
2. **Retention period, and who may play or delete recordings.** Today only super admins delete.
3. **The consent announcement wording**, and whether it plays automatically.
4. **Whether browser-call recordings replace or sit beside the current manual uploads** from company Android phones.
5. **Whether and how calls count in Performance.** This is decision C-19; until it is made, calls are not scored.

## 5. Recommendation

**Run a short paid pilot with Twilio or Plivo, outbound only, before writing an adapter. Pick whichever confirms in writing how your caller ID appears on Pakistani mobiles. Plivo is cheaper on the rates read (USD 0.1410 vs 0.1800/min to PK mobile); Twilio has the most mature SDK.** If the pilot shows foreign or unknown caller IDs hurt answer rates, the long-term answer is self-hosted SIP (Asterisk or FreeSWITCH, plus SIP.js) on a licensed Pakistani operator's trunk. That is the only route to a local `+92` caller ID, at high setup and operating effort.

### What the client must provide

Common to every option:
- The provider decision.
- The production HTTPS domain.
- Answers to the recording-storage questions in §4.
- A list of which roles may place browser calls.

For a cloud provider (example: Twilio):
- `VOIP_PROVIDER=twilio`.
- Account SID, an API key SID and secret (not the master auth token), and a TwiML App SID whose voice URL points to the CRM.
- The verified caller ID number to present (`TWILIO_CALLER_ID`).
- Written confirmation of caller-ID behaviour to Pakistan.

The env names for each provider are in `.env.example` and `REQUIRED_ENV` in `src/modules/voip/providers.ts`:

| Provider | Required env names |
|---|---|
| Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_TWIML_APP_SID`, `TWILIO_CALLER_ID` |
| Vonage | `VONAGE_APPLICATION_ID`, `VONAGE_PRIVATE_KEY_PATH`, `VONAGE_CALLER_ID` |
| Plivo | `PLIVO_AUTH_ID`, `PLIVO_AUTH_TOKEN`, `PLIVO_APP_ID`, `PLIVO_CALLER_ID` |
| Telnyx | `TELNYX_API_KEY`, `TELNYX_CREDENTIAL_CONNECTION_ID`, `TELNYX_PUBLIC_KEY` (webhook signature), `TELNYX_CALLER_ID` |

For self-hosted SIP:
- The operator contract and trunk details: SIP host, authentication or IP authentication, number block, and caller-ID rules.
- A PTA-whitelisted public IP for the PBX.
- PBX server access.
- The env values `SIP_WSS_URI`, `SIP_DOMAIN`, `SIP_TURN_URI` and `SIP_TURN_SECRET`.
- Per-agent SIP extensions, which a future adapter would mint per user.
