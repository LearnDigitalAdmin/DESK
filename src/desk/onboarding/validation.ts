import { normalizeKenyaPhone, phoneProblem } from "../access/phone";

export interface ApplicationFields {
  name: string; phone: string; idNumber: string;
  county: string; constituency: string; ward: string;
  /** Optional: a senior's (you become a clerk), lead's (senior) or admin's (lead) desk code. */
  uplineCode?: string;
  /** Optional: an invite code; the role comes from the invite. */
  inviteCode?: string;
  /** Only offered when the ward already has the hierarchy; empty means clerk under Samuhia. */
  role?: "" | "clerk" | "senior" | "lead";
}
export type ApplicationErrors = Partial<Record<keyof ApplicationFields, string>>;

/** Missing values behave like empty strings, so validation reports problems instead of throwing. */
const s = (v: string | undefined | null): string => (v ?? "").trim();

/** Same limits the server enforces in desk_applyAgent: name 2-80, Safaricom phone, ID 6-12 digits, a real county/constituency/ward, valid codes. */
export function validateApplication(f: ApplicationFields): ApplicationErrors {
  const e: ApplicationErrors = {};
  const name = s(f.name).replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) e.name = "Enter your full name (2 to 80 characters).";
  { const p = phoneProblem(f.phone ?? ""); if (p) e.phone = p; }
  if (!/^\d{6,12}$/.test(s(f.idNumber))) e.idNumber = "Your ID number is 6 to 12 digits, numbers only.";
  if (!s(f.county)) e.county = "Choose your county.";
  if (!s(f.constituency)) e.constituency = "Choose your constituency.";
  if (!s(f.ward)) e.ward = "Choose your ward.";
  const up = s(f.uplineCode).toUpperCase(), inv = s(f.inviteCode).toUpperCase();
  if (up && !/^COG-\d{4,}$/.test(up)) e.uplineCode = "An agent code looks like COG-0123.";
  if (inv && !/^[A-HJKMNP-Z2-9]{8}$/.test(inv)) e.inviteCode = "An invite code is 8 letters and numbers.";
  if (up && inv) e.inviteCode = "Use an agent code or an invite code, not both.";
  return e;
}

/** Cleaned values exactly as they are sent (`wardId` stays for older servers and is ignored when the names are sent). */
export function cleanApplication(f: ApplicationFields) {
  const up = s(f.uplineCode).toUpperCase(), inv = s(f.inviteCode).toUpperCase();
  const phone = s(f.phone);
  const ward = s(f.ward);
  return {
    name: s(f.name).replace(/\s+/g, " "),
    phone: normalizeKenyaPhone(phone) ?? phone,
    idNumber: s(f.idNumber),
    wardId: ward,
    county: s(f.county), constituency: s(f.constituency), ward,
    ...(up ? { uplineCode: up } : {}), ...(inv ? { inviteCode: inv } : {}),
    ...(!up && !inv && f.role ? { role: f.role } : {}),
  };
}