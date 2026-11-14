# Landlord Watch on WhatsApp

A landlord watches a property managed by an agency from WhatsApp: summary, who has paid, money breakdown, other months,
and the monthly transcript (PDF). English and Kiswahili. All data comes from the Landlord Watch backend
(`LANDLORD_WATCH_CONTRACT.md` v1.1, Transport B); the bot never reads rental data from Firestore and never computes money,
percentages, masking or quota: it renders the server's `d` strings.

## Entry
Main menu option **7. Landlord Watch** (Kiswahili: *Landlord Watch – Fuatilia mali yako*), or type `WATCH`, `LANDLORD` or
`MWENYE NYUMBA` at the main menu. The sender's WhatsApp number is the actor (`actor.phone`, E.164).

## Files
| File | Role |
|---|---|
| `handlers/watch.handler.ts` | The conversation engine (`WatchFlow`). Dependency-injected, no Firebase imports. |
| `handlers/watch.entry.ts` | Production wiring: session store, WhatsApp sender, real clock. Called by the menu handler and the webhook. |
| `services/watch.api.ts` | Typed client for `lwBotApi` + error normalisation + `createWatchApi()` (mock switch). |
| `services/watch.mock.ts` | In-memory backend for `LW_MOCK=1`. |
| `services/wa.sender.ts` | Buttons, list messages and documents via the Cloud API (limits enforced, numbered-text fallback). |
| `services/message-dedup.service.ts`, `utils/dedup.ts` | Handle each WhatsApp message id once (webhook retries). |
| `utils/watch.format.ts` | Owner-ID / phone normalisation, pagination, dates (Nairobi, Swahili months), nav commands. |
| `utils/watch.render.ts` | Snapshot to text (summary, lists, money, trend). |
| `utils/watch.poll.ts` | Transcript polling (3 s, 90 s, one nudge). |
| `constants/watch.messages.ts` | Every string in `en` and `sw`, plus the `LW_*` error mapping. |
| `types/watch.types.ts`, `config/watch.config.ts` | Contract types; secret and env. |
| `__tests__/watch/*` | Unit and conversation tests. |

Edits to shared files are small: `constants/states.ts` (7 `WATCH_*` states), `constants/menus.ts` (option 7),
`handlers/menu.handler.ts` (option 7 + keywords), `webhooks/whatsapp-webhook.ts` (interactive replies, dedup, routing,
log redaction), `types/whatsapp.types.ts` (interactive reply fields), `index.ts` (bind `LW_BOT_API_KEY`, timeout 180 s).

## Configuration
| Name | Kind | Meaning |
|---|---|---|
| `LW_BOT_API_KEY` | Secret Manager secret (exists already) | Sent as `x-lw-key`. Bound to `whatsappWebhook`. Never logged. |
| `LW_API_URL` | env, optional | Default `https://africa-south1-plot-9fd6e.cloudfunctions.net/lwBotApi` |
| `LW_MOCK` | env | `1` = in-memory mock. **Unset it to go live: no code change.** |
| `LW_MOCK_OWNER_PHONE` | env, mock only | Owner phone of PYP-0001/0003. Set it to your own number (`+2547...`) to see auto-unlock. |
| `LW_MOCK_LEVEL` | env, mock only | `full` to see the fully masked fixture. |

## Try it with the mock
```bash
cd functions
npm ci
echo 'LW_MOCK=1' >> .env.local        # or export LW_MOCK=1 before starting the emulator
npm run serve                          # builds and starts the functions emulator
```
Then message the bot, choose a language, send `7` (or `WATCH`).

Mock data: `PYP-0001` Sunrise Apartments (found), `PYP-0003` same owner phone (one code unlocks both), `PYP-0002` other owner,
`PYP-0004` no phone on file, `PYP-0100`..`PYP-0199` filler properties (paging, 25-property limit), `PYP-9999` not found.
Verification code is always `123456`; five wrong tries lock it; resend needs 60 s. The first transcript each month is free,
the next costs the server price; M-Pesa "completes" ~6 s after the push; pay with `+254700000000` to simulate a failure.
The mock keeps state in the process: use the emulator / one instance.

## Behaviour notes
- **Session**: only owner id, month, page, picker purpose, pending owner id, pending request id, resend time and the last
  option ids are stored (`context.lw`). No codes, URLs, names, phones or snapshots. Snapshots are fetched on demand.
- **Typed fallback**: every button/list also works by typing its number; `0` back, `#` main menu, `help`, `lugha`, `resend`.
- **Waiting for M-Pesa** happens inside the request (up to 90 s, so the function timeout is 180 s). A message sent while
  waiting is handled by another invocation; if it moves the session out of `WATCH_TR_PAYING` the wait stops quietly.
- **24 h window**: the bot only replies to inbound messages. If Meta reports the window closed (131047) it stops sending.
- **Never auto-retries** OTP sends; the resend button is refused locally until the server's cool-down has passed.

## Tests
```bash
cd functions
npx tsc --noEmit
npx tsc && node --test "lib/__tests__/watch/*.test.js"
```

## Compliance reports (Tax report, MRI)

Menu row **Tax report (MRI)** (shown only when the owner's details are unlocked; the list stays within WhatsApp's 10 rows).
Flow: choose *MRI working paper* or *Annual summary* → pick the month → the server prices it → **checkout** → PDF as a WhatsApp document.

| Step | Bot call (`lwBotApi` action) | Notes |
|---|---|---|
| existing report for that month and kind? | `reportList {ownerId}` | ready ones can be sent again for free (7 days); never carries a link |
| order | `reportOrder {ownerId, month, kind}` | `payment_required`, `priceKes` 0 (free allowance) or 200 |
| free checkout | `reportCheckout {orderId}` | no phone: uses the month's free report; if it was used meanwhile the reply is `payment_required` with `priceKes: 200` and nothing is charged |
| paid checkout | `reportCheckout {orderId, phone}` | M-Pesa STK to the chosen number (E.164) |
| wait / deliver | `reportStatus {orderId}` | polled like transcripts; `url` exists only once `ready`; the bot sends it once as a document and never stores or logs it |

The bot renders the server's numbers (price, allowance) and never decides them. Error codes added: `LW_REPORT_NO_DATA` (no synced records yet) and `LW_REPORT_STALE` (records not synced for over 7 days: the report cannot be ordered or paid for).
Tests: `src/__tests__/watch/reports.test.ts` (mock backend: `reportQuote/Order/Checkout/Status/List`, same rules as the server).
