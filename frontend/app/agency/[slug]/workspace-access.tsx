"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "./workspace-access.module.css";

const configuredApi = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
type Workspace = { slug: string; name: string; role: string };
type AccessRequest = { status: "PENDING" | "APPROVED" | "DENIED"; organization: { slug: string; name: string } };
type PendingRequest = { id: string; createdAt: string; user: { id: string; name: string; email: string; emailVerifiedAt: string | null } };
type ViewState = "loading" | "signed-out" | "member" | "requested" | "error";

function apiBase() {
  return configuredApi ?? (typeof window === "undefined"
    ? "http://localhost:4000/api"
    : `${window.location.protocol}//${window.location.hostname}:4000/api`);
}

export default function WorkspaceAccess({ slug }: { slug: string }) {
  const router = useRouter();
  const [state, setState] = useState<ViewState>("loading");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [requestStatus, setRequestStatus] = useState<AccessRequest["status"] | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadAccess() {
      try {
        const identityResponse = await fetch(`${apiBase()}/auth/me`, { credentials: "include" });
        if (identityResponse.status === 401) {
          if (active) setState("signed-out");
          return;
        }
        if (!identityResponse.ok) throw new Error("We couldn’t check your workspace access. Please try again.");

        const [workspaceResponse, requestsResponse] = await Promise.all([
          fetch(`${apiBase()}/auth/workspaces`, { credentials: "include" }),
          fetch(`${apiBase()}/access-requests`, { credentials: "include" }),
        ]);
        if (!workspaceResponse.ok || !requestsResponse.ok) throw new Error("We couldn’t check your workspace access. Please try again.");

        const workspaceData = await workspaceResponse.json() as { workspaces: Workspace[] };
        const requestsData = await requestsResponse.json() as { requests: AccessRequest[] };
        const memberWorkspace = workspaceData.workspaces.find((item) => item.slug === slug);
        if (!active) return;
        if (memberWorkspace) {
          setWorkspace(memberWorkspace);
          setState("member");
          if (["OWNER", "ADMIN"].includes(memberWorkspace.role)) {
            const adminResponse = await fetch(`${apiBase()}/access-requests/organization/${encodeURIComponent(slug)}`, { credentials: "include" });
            if (adminResponse.ok) {
              const adminData = await adminResponse.json() as { requests: PendingRequest[] };
              if (active) setPendingRequests(adminData.requests);
            }
          }
          return;
        }

        const previousRequest = requestsData.requests.find((item) => item.organization.slug === slug);
        setRequestStatus(previousRequest?.status ?? null);
        setState("requested");
      } catch (error) {
        if (active) {
          setMessage(error instanceof Error ? error.message : "We couldn’t check your workspace access.");
          setState("error");
        }
      }
    }
    void loadAccess();
    return () => { active = false; };
  }, [slug]);

  async function requestAccess() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${apiBase()}/access-requests`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationSlug: slug }),
      });
      const payload = await response.json() as { error?: string; request?: { status: "PENDING" } };
      if (!response.ok) throw new Error(payload.error ?? "We couldn’t send your access request.");
      setRequestStatus(payload.request?.status ?? "PENDING");
      setMessage("Your request has been sent to the workspace administrator.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We couldn’t send your access request.");
    } finally {
      setBusy(false);
    }
  }

  async function enterWorkspace() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${apiBase()}/auth/switch-workspace`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Workspace access is no longer active.");
      router.push("/");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Workspace access is no longer active.");
      setBusy(false);
    }
  }

  async function reviewAccess(requestId: string, decision: "approve" | "deny") {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${apiBase()}/access-requests/organization/${encodeURIComponent(slug)}/${encodeURIComponent(requestId)}/${decision}`, {
        method: "POST",
        credentials: "include",
      });
      const payload = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(payload.error ?? "The access request could not be reviewed.");
      setPendingRequests((current) => current.filter((request) => request.id !== requestId));
      setMessage(payload.message ?? "Access request reviewed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The access request could not be reviewed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <Link className={styles.brand} href="/" aria-label="Techiesee home"><span>✳</span> TECHIESEE</Link>
      <section className={styles.card} aria-live="polite">
        <div className={styles.kicker}>PRIVATE BUSINESS WORKSPACE</div>
        <div className={styles.lock} aria-hidden="true">{state === "member" ? "✓" : "⌑"}</div>
        {state === "loading" && <><h1>Checking your access.</h1><p>Verifying your account and workspace membership.</p></>}
        {state === "signed-out" && <>
          <h1>Sign in to request access.</h1>
          <p>This link identifies a workspace; it does not grant access. Sign in with your verified account, then return here to request membership.</p>
          <Link className={styles.button} href={`/?returnTo=${encodeURIComponent(`/agency/${slug}`)}`}>Go to secure sign in <span>↗</span></Link>
        </>}
        {state === "member" && <>
          <h1>You’re a member.</h1>
          <p>Your account has an active <strong>{workspace?.role.toLowerCase()}</strong> membership in this workspace.</p>
          <button className={styles.button} onClick={enterWorkspace} disabled={busy}>Open workspace <span>↗</span></button>
          {["OWNER", "ADMIN"].includes(workspace?.role ?? "") && <div className={styles.reviewPanel}>
            <div className={styles.reviewHeading}>PENDING ACCESS REQUESTS <span>{pendingRequests.length.toString().padStart(2, "0")}</span></div>
            {pendingRequests.length === 0 ? <p className={styles.reviewEmpty}>No requests need your review.</p> : pendingRequests.map((request) => (
              <div className={styles.reviewRequest} key={request.id}>
                <div><strong>{request.user.name}</strong><span>{request.user.email}</span>{!request.user.emailVerifiedAt && <small>Email not verified</small>}</div>
                <div className={styles.reviewActions}>
                  <button onClick={() => void reviewAccess(request.id, "deny")} disabled={busy}>Deny</button>
                  <button onClick={() => void reviewAccess(request.id, "approve")} disabled={busy || !request.user.emailVerifiedAt}>Approve</button>
                </div>
              </div>
            ))}
          </div>}
        </>}
        {state === "requested" && <>
          <h1>Access required.</h1>
          <p>You don’t currently have access to this workspace. An active account membership and administrator approval are required.</p>
          {requestStatus === "PENDING" ? <div className={styles.pending}>REQUEST PENDING · An administrator needs to review your request.</div> : (
            <button className={styles.button} onClick={requestAccess} disabled={busy}>
              {busy ? "Sending request…" : requestStatus === "DENIED" ? "Request access again" : "Request access"} <span>↗</span>
            </button>
          )}
        </>}
        {state === "error" && <><h1>We couldn’t check access.</h1><p>{message}</p><Link className={styles.secondary} href="/">Return to sign in</Link></>}
        {message && state !== "error" && <p className={styles.message} role="status">{message}</p>}
        <div className={styles.securityNote}><span>✳</span> A shared link can identify a workspace, never unlock one.</div>
      </section>
      <footer>YOUR ACCOUNT · ACTIVE MEMBERSHIP · SERVER-SIDE AUTHORIZATION</footer>
    </main>
  );
}
