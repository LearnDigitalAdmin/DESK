# DEPLOY_DESK_UI: Lipa Mdogo Mdogo desk and top-desk screens

Run everything from the DESK repo root (hosting site `cyber-0`, project `plot-9fd6e`). No secrets and no functions are involved.

## 0. Check the contract copy
```bash
sha256sum src/desk/api/lmmxContract.ts
# must print b1357fd4c3385c27ba1e7e5e636166d6dc636369d4abeb027ce31d079cd207b7
```
If CORE has issued a new contract version, replace the file byte for byte with CORE's copy and compare this hash with the one in CORE's report.

## 1. Test
```bash
npm ci
node --test src/desk/modules/lmm/lmm.test.ts src/desk/api/lmmx.test.ts src/desk/modules/lmm-top/logic.test.ts
npx tsx --test src/desk/modules/*/*.test.ts tests/desk-ui/*.test.ts   # the repo's existing UI tests (extensionless imports need tsx)
```

## 2. Demo build (no backend needed)
```bash
VITE_LMMX_MOCK=true npm run build
firebase deploy --only hosting --project plot-9fd6e      # or: npm run dev with VITE_LMMX_MOCK=true in .env.local
```
In demo mode every call is answered by fixtures. Magic inputs: setup code `4683`; a new tenant becomes active by itself after about 40 seconds;
ID ending `000` = locked, ending `111` = expired code, `00000001` = desk not ready; landlord account name containing "mismatch" = needs review;
till/phone account ending `0001` = reusable existing landlord, `0002` = exists but not reusable; account `999999` = blocked.
Top-desk changes first answer "sign in again"; the demo sign-in button clears it. In the browser console `__lmmxMock.failNext("LMMX_E_RATE")` forces any error code.

## 3. Live build
Once CORE reports its callables deployed (region `africa-south1`), build with the variable UNSET:
```bash
unset VITE_LMMX_MOCK
npm run build
firebase deploy --only hosting --project plot-9fd6e
```
Check `.env*` files do not set `VITE_LMMX_MOCK`. Lipa Mdogo Mdogo stays hidden behind CORE's switch (`lmm_config/standalone.enabled`, default off): desks see "not switched on yet" until it is flipped.

## 4. Smoke test (live)
1. Sign in as a normal desk: open **Lipa Mdogo Mdogo**, add a test tenant, see "Waiting for verification", type the code from the SMS, land on the tenant page.
2. Open the tenant, change rent, confirm the SMS code, see the new state.
3. Sign in as COG-0000: open **Lipa Mdogo Mdogo (top desk)**: Review, Tenants (all desks), Audit log (press Verify chain: OK), Leads, Stats.
4. Do one top-desk action: it asks for a reason of 10+ characters, and after 15 minutes of sign-in it asks for the password again.
