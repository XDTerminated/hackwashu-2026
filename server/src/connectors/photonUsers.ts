// Photon project users. On shared-pool plans a project may only text people
// registered as project users; registering one assigns them a number from
// Photon's pool (up to the plan's maxSharedUsers). Texting anyone else fails
// with "Target not allowed for this project".

const BASE = "https://spectrum.photon.codes";

export interface PhotonUser {
  id: string;
  phoneNumber: string;
  /** The colony's number, as this person sees it. */
  assignedPhoneNumber: string;
}

function auth() {
  const id = process.env.SPECTRUM_PROJECT_ID ?? process.env.PHOTON_PROJECT_ID;
  const secret = process.env.SPECTRUM_PROJECT_SECRET ?? process.env.PHOTON_PROJECT_SECRET;
  if (!id || !secret) throw new Error("Photon project credentials are missing");
  return { id, header: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}` };
}

/** Idempotent: registering a number that's already a user returns that user. */
export async function registerSharedUser(phoneNumber: string): Promise<PhotonUser> {
  const { id, header } = auth();
  const res = await fetch(`${BASE}/projects/${id}/users/`, {
    method: "POST",
    headers: { Authorization: header, "content-type": "application/json" },
    body: JSON.stringify({ type: "shared", phoneNumber }),
  });
  const body = (await res.json().catch(() => ({}))) as { succeed?: boolean; data?: PhotonUser; error?: { message?: string }; message?: string };
  if (!res.ok || !body.data) {
    const why = body.error?.message ?? body.message ?? `HTTP ${res.status}`;
    throw new Error(`Photon couldn't register that number: ${why}`);
  }
  return body.data;
}

/** A public link that opens the person's Messages app to their colony number. */
export function textUsLink(userId: string): string {
  return `${BASE}/users/${userId}/redirect`;
}
