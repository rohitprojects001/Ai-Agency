"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AgentsPanel, AutomationsPanel, ChannelsPanel, type Agent, type AutomationRun, type AutomationWorkflow, type ChannelAvailability } from "./workspace-modules";

const CONFIGURED_API_BASE = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
const TOKEN_KEY = "rohit-ai-session";
const LEAD_STAGES = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"] as const;
const NAV_ITEMS = [
  { id: "overview", label: "Overview", index: "01" },
  { id: "inbox", label: "Conversation desk", index: "02" },
  { id: "pipeline", label: "Lead pipeline", index: "03" },
  { id: "contacts", label: "Contacts", index: "04" },
  { id: "appointments", label: "Appointments", index: "05" },
  { id: "catalog", label: "Offer library", index: "06" },
  { id: "agents", label: "AI agents", index: "07" },
  { id: "automations", label: "Automation engine", index: "08" },
  { id: "channels", label: "Channels & calls", index: "09" },
  { id: "settings", label: "Business setup", index: "10" },
] as const;

type ViewId = (typeof NAV_ITEMS)[number]["id"];
type LeadStage = (typeof LEAD_STAGES)[number];
type User = { id: string; name: string; email: string };
type Organization = {
  id: string;
  name: string;
  slug: string;
  mode?: "TRIAL" | "LIVE";
  status?: "ACTIVE" | "SUSPENDED";
  trialStartedAt?: string;
  trialEndsAt?: string | null;
};
type Session = { user: User; organization: Organization; role: string; isPlatformAdmin?: boolean };
type Contact = { id: string; name: string; phone?: string | null; email?: string | null; company?: string | null; tags: string[]; createdAt: string };
type Lead = { id: string; status: LeadStage; source?: string | null; score: number; value?: number | null; contact: Contact };
type Message = { id: string; sender: "CUSTOMER" | "AI" | "HUMAN"; content: string; createdAt: string; isDemo: boolean };
type Conversation = { id: string; channel: string; status: "OPEN" | "ESCALATED" | "CLOSED"; updatedAt: string; contact: Contact; messages: Message[] };
type Appointment = { id: string; service: string; scheduledAt: string; durationMin: number; status: string; notes?: string | null; contact: Contact };
type Product = { id: string; name: string; description?: string | null; category?: string | null; price: number; durationMin?: number | null; isActive: boolean };
type BusinessProfile = {
  businessName: string;
  category?: string | null;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  timezone?: string | null;
  aiInstructions?: string | null;
  whatsappPhoneNumberId?: string | null;
  twilioPhoneNumber?: string | null;
  outboundEmail?: string | null;
};
type Snapshot = {
  contacts: Contact[];
  leads: Lead[];
  conversations: Conversation[];
  appointments: Appointment[];
  products: Product[];
  agents: Agent[];
  workflows: AutomationWorkflow[];
  automationRuns: AutomationRun[];
  channelAvailability: ChannelAvailability | null;
  profile: BusinessProfile | null;
  whatsapp: { mode?: "TRIAL" | "LIVE"; serverConfigured: boolean; numberLinked: boolean; connected: boolean } | null;
  errors: string[];
};
type ModalKind = "contact" | "lead" | "product" | "simulate" | null;
type MiraMessage = { role: "user" | "assistant"; content: string };

const DEMO_SESSION: Session = {
  user: { id: "demo-user", name: "Rohit Mehra", email: "rohit@studio.local" },
  organization: { id: "demo-org", name: "Rohit AI Studio", slug: "rohit-ai-studio", mode: "TRIAL", status: "ACTIVE" },
  role: "OWNER",
  isPlatformAdmin: true,
};

const EMPTY_SNAPSHOT: Snapshot = {
  contacts: [],
  leads: [],
  conversations: [],
  appointments: [],
  products: [],
  agents: [],
  workflows: [],
  automationRuns: [],
  channelAvailability: null,
  profile: null,
  whatsapp: null,
  errors: [],
};

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  void token;
  if (!CONFIGURED_API_BASE && process.env.NODE_ENV === "production") {
    throw new Error("NEXT_PUBLIC_API_URL is not set");
  }
  const apiBase = CONFIGURED_API_BASE
    ?? (typeof window === "undefined" ? "http://localhost:4000/api" : `http://${window.location.hostname}:4000/api`);
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
  return payload as T;
}

async function fetchSnapshot(token: string): Promise<Snapshot> {
  const [contacts, leads, conversations, appointments, products, agents, workflows, automationRuns, channelAvailability, profile, whatsapp] = await Promise.allSettled([
    request<{ contacts: Contact[] }>("/contacts", {}, token),
    request<{ leads: Lead[] }>("/leads", {}, token),
    request<{ conversations: Conversation[] }>("/conversations", {}, token),
    request<{ appointments: Appointment[] }>("/appointments", {}, token),
    request<{ products: Product[] }>("/products", {}, token),
    request<{ agents: Agent[] }>("/agents", {}, token),
    request<{ workflows: AutomationWorkflow[] }>("/automations", {}, token),
    request<{ runs: AutomationRun[] }>("/automations/runs", {}, token),
    request<{ channels: ChannelAvailability }>("/channels/status", {}, token),
    request<{ profile: BusinessProfile }>("/business-profile", {}, token),
    request<Snapshot["whatsapp"]>("/business-profile/whatsapp-status", {}, token),
  ]);
  const errors = [contacts, leads, conversations, appointments, products, agents, workflows, automationRuns, channelAvailability, profile, whatsapp]
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason instanceof Error ? result.reason.message : "A section could not load");

  return {
    contacts: contacts.status === "fulfilled" ? contacts.value.contacts : [],
    leads: leads.status === "fulfilled" ? leads.value.leads : [],
    conversations: conversations.status === "fulfilled" ? conversations.value.conversations : [],
    appointments: appointments.status === "fulfilled" ? appointments.value.appointments : [],
    products: products.status === "fulfilled" ? products.value.products : [],
    agents: agents.status === "fulfilled" ? agents.value.agents : [],
    workflows: workflows.status === "fulfilled" ? workflows.value.workflows : [],
    automationRuns: automationRuns.status === "fulfilled" ? automationRuns.value.runs : [],
    channelAvailability: channelAvailability.status === "fulfilled" ? channelAvailability.value.channels : null,
    profile: profile.status === "fulfilled" ? profile.value.profile : null,
    whatsapp: whatsapp.status === "fulfilled" ? whatsapp.value : null,
    errors,
  };
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase();
}

function money(value?: number | null) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value ?? 0);
}

function relativeTime(value?: string) {
  if (!value) return "just now";
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function AppMark() {
  return <span className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></span>;
}

function MiraPanel({ snapshot, view, token, onClose }: { snapshot: Snapshot; view: ViewId; token: string; onClose: () => void }) {
  const [messages, setMessages] = useState<MiraMessage[]>([
    { role: "assistant", content: "Hi, I’m Mira. I’m watching your workspace. Ask me what deserves attention today." },
  ]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const context = {
    contacts: snapshot.contacts.length,
    leads: snapshot.leads.length,
    newLeads: snapshot.leads.filter((lead) => lead.status === "NEW").length,
    openConversations: snapshot.conversations.filter((conversation) => conversation.status !== "CLOSED").length,
    appointments: snapshot.appointments.length,
    products: snapshot.products.length,
  };

  const askMira = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || sending) return;
    const nextMessages = [...messages, { role: "user" as const, content: message }];
    setMessages(nextMessages);
    setDraft("");
    setSending(true);
    try {
      const result = await request<{ reply: string }>("/assistant/chat", {
        method: "POST",
        body: JSON.stringify({ message, history: messages.slice(-10), view, context }),
      }, token);
      setMessages([...nextMessages, { role: "assistant", content: result.reply }]);
    } catch (error) {
      setMessages([...nextMessages, { role: "assistant", content: error instanceof Error ? error.message : "Mira is unavailable right now." }]);
    } finally {
      setSending(false);
    }
  };

  const suggestions = [
    `What should I focus on in ${context.newLeads} new leads?`,
    "Give me one growth idea for this business",
    "What looks risky in my dashboard?",
  ];

  return (
    <aside className="mira-panel" aria-label="Mira business assistant">
      <div className="mira-head">
        <div className="mira-identity"><span className="mira-orb"><AppMark /></span><span><strong>Mira</strong><small>YOUR BUSINESS ADVISOR</small></span></div>
        <button className="icon-button mira-close" onClick={onClose} aria-label="Close Mira">×</button>
      </div>
      <div className="mira-signal"><i /> LIVE DASHBOARD CONTEXT <span>{view.toUpperCase()}</span></div>
      <div className="mira-messages">
        {messages.map((item, index) => <div key={`${item.role}-${index}`} className={`mira-message ${item.role}`}><span>{item.role === "assistant" ? "M" : "YOU"}</span><p>{item.content}</p></div>)}
        {sending && <div className="mira-typing"><i /><i /><i /></div>}
      </div>
      <div className="mira-suggestions">{suggestions.map((suggestion) => <button key={suggestion} onClick={() => setDraft(suggestion)}>{suggestion}<span>↗</span></button>)}</div>
      <form className="mira-composer" onSubmit={askMira}>
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask Mira anything..." rows={2} aria-label="Ask Mira anything" />
        <button className="button button-acid" type="submit" disabled={!draft.trim() || sending} aria-label="Send message">↗</button>
      </form>
      <p className="mira-footnote">Mira uses your workspace data to keep advice practical.</p>
    </aside>
  );
}

function Metric({ label, value, detail, tone, chart }: { label: string; value: string | number; detail: string; tone: string; chart: string }) {
  return (
    <article className={`metric-card ${tone}`}>
      <div className="metric-top"><span>{label}</span><span className="metric-arrow">↗</span></div>
      <div className="metric-value">{value}</div>
      <div className="metric-bottom"><span>{detail}</span><span className="mini-chart" aria-hidden="true">{chart}</span></div>
    </article>
  );
}

function Home() {
  const router = useRouter();
  const [token, setToken] = useState("cookie-session");
  const [session, setSession] = useState<Session | null>(DEMO_SESSION);
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT);
  const [booting, setBooting] = useState(true);
  const [now, setNow] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<ViewId>("overview");
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<ModalKind>(null);
  const [activeConversation, setActiveConversation] = useState("");
  const [reply, setReply] = useState("");
  const [toast, setToast] = useState("");
  const [pageError, setPageError] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register" | "forgot" | "reset">("login");
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [verificationEmail, setVerificationEmail] = useState("");
  const [showResendVerification, setShowResendVerification] = useState(false);
  const [miraOpen, setMiraOpen] = useState(false);

  useEffect(() => {
    window.localStorage.removeItem(TOKEN_KEY);
    const returnTo = new URLSearchParams(window.location.search).get("returnTo");
    if (returnTo?.startsWith("/agency/") && !returnTo.startsWith("//") && !returnTo.includes("\\")) {
      window.sessionStorage.setItem("rohit-ai-return-to", returnTo);
      window.history.replaceState({}, "", window.location.pathname);
    }
    const action = new URLSearchParams(window.location.search);
    const authAction = action.get("authAction");
    const challengeToken = action.get("token") ?? "";
    if (authAction === "reset-password" && challengeToken) {
      window.setTimeout(() => {
        setResetToken(challengeToken);
        setAuthMode("reset");
      }, 0);
      window.history.replaceState({}, "", window.location.pathname);
    } else if (authAction === "verify-email" && challengeToken) {
      window.history.replaceState({}, "", window.location.pathname);
      void request<{ message: string }>("/auth/verify-email", {
        method: "POST",
        body: JSON.stringify({ token: challengeToken }),
      }).then((result) => setAuthNotice(result.message))
        .catch((error: unknown) => setAuthError(error instanceof Error ? error.message : "Email verification failed"));
    }
    const timer = window.setTimeout(() => {
      setToken("cookie-session");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setNow(Date.now()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!token) return;
    let current = true;
    void (async () => {
      try {
        const [identity, data] = await Promise.all([
          request<Session>("/auth/me", {}, token),
          fetchSnapshot(token),
        ]);
        if (!current) return;
        setSession(identity);
        setSnapshot(data);
        setActiveConversation((selected) => selected || data.conversations[0]?.id || "");
        setPageError(data.errors.length === 11 ? "The backend is reachable, but workspace data could not be loaded." : "");
      } catch (error) {
        if (!current) return;
        setToken("cookie-session");
        setSession(DEMO_SESSION);
        setSnapshot(EMPTY_SNAPSHOT);
        setPageError(error instanceof Error ? error.message : "Using demo workspace while the backend is unavailable");
      } finally {
        if (current) setBooting(false);
      }
    })();
    return () => { current = false; };
  }, [token]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const applySnapshot = (data: Snapshot) => {
    setSnapshot(data);
    setActiveConversation((selected) => selected || data.conversations[0]?.id || "");
    setPageError(data.errors.length === 11 ? "Workspace data is unavailable. Check that the backend and database are running." : "");
  };

  const reload = async (quiet = false) => {
    if (!token) return;
    if (!quiet) setRefreshing(true);
    try {
      applySnapshot(await fetchSnapshot(token));
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not refresh workspace data");
    } finally {
      setRefreshing(false);
    }
  };

  const signOut = () => {
    void request("/auth/logout", { method: "POST" }).catch(() => {});
    window.localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setSession(null);
    setSnapshot(EMPTY_SNAPSHOT);
    setToast("Signed out of this workspace");
  };

  const handlePlatformModeChange = (organizationId: string, mode: "TRIAL" | "LIVE" | "SUSPENDED") => {
    if (session?.organization.id !== organizationId) return;
    if (mode === "SUSPENDED") {
      signOut();
      return;
    }
    setSession({ ...session, organization: { ...session.organization, mode, status: "ACTIVE" } });
  };

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError("");
    setAuthNotice("");
    setBooting(true);
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const email = String(values.email ?? "").trim().toLowerCase();
      setVerificationEmail(email);
      if (authMode === "forgot") {
        const result = await request<{ message: string }>("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
        setAuthNotice(result.message);
        setBooting(false);
        return;
      }
      if (authMode === "reset") {
        const result = await request<{ message: string }>("/auth/reset-password", { method: "POST", body: JSON.stringify({ token: resetToken, password: values.password }) });
        setAuthMode("login");
        setAuthNotice(result.message);
        setBooting(false);
        return;
      }
      const endpoint = authMode === "register" ? "/auth/register" : "/auth/login";
      const body = authMode === "register"
        ? { name: values.name, email, password: values.password, businessName: values.businessName }
        : { email, password: values.password };
      const result = await request<{ verificationRequired?: boolean; message?: string; user: User; organization: Organization; role: string }>(endpoint, {
        method: "POST",
        body: JSON.stringify(body),
      });

      if (result.verificationRequired) {
        setAuthNotice(result.message ?? "Check your email for a verification link before signing in.");
        setShowResendVerification(true);
        setAuthMode("login");
        setBooting(false);
        return;
      }
      window.localStorage.removeItem(TOKEN_KEY);
      const returnTo = window.sessionStorage.getItem("rohit-ai-return-to");
      if (returnTo?.startsWith("/agency/") && !returnTo.startsWith("//") && !returnTo.includes("\\")) {
        window.sessionStorage.removeItem("rohit-ai-return-to");
        router.push(returnTo);
        return;
      }
      setSession({ user: result.user, organization: result.organization, role: result.role });
      setToken("cookie-session");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not sign in");
      setBooting(false);
    }
  };

  const finishAction = async (message: string) => {
    await reload(true);
    setToast(message);
    setModal(null);
  };

  const submitModal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      if (modal === "contact") {
        await request("/contacts", { method: "POST", body: JSON.stringify({
          name: values.name,
          phone: values.phone || undefined,
          email: values.email || undefined,
          company: values.company || undefined,
          tags: String(values.tags ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
        }) });
        await finishAction("Contact added to your workspace");
      }
      if (modal === "lead") {
        await request("/leads", { method: "POST", body: JSON.stringify({
          contactId: values.contactId,
          source: values.source || undefined,
          value: values.value ? Number(values.value) : undefined,
        }) });
        await finishAction("Lead added to your pipeline");
      }
      if (modal === "product") {
        await request("/products", { method: "POST", body: JSON.stringify({
          name: values.name,
          description: values.description || undefined,
          category: values.category || undefined,
          price: Number(values.price),
          durationMin: values.durationMin ? Number(values.durationMin) : undefined,
        }) });
        await finishAction("Offer added to your library");
      }
      if (modal === "simulate") {
        await request("/conversations/whatsapp/simulate", { method: "POST", body: JSON.stringify({
          contactName: values.contactName,
          contactPhone: values.contactPhone,
          message: values.message,
        }) });
        await reload(true);
        setView("inbox");
        setToast("Demo message sent through your AI assistant");
        setModal(null);
      }
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "That action did not complete");
    }
  };

  const sendReply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeConversation || !reply.trim()) return;
    try {
      const result = await request<{ conversation: Conversation }>(`/conversations/${activeConversation}/reply`, { method: "POST", body: JSON.stringify({ content: reply.trim() }) });
      setReply("");
      await reload(true);
      const latest = result.conversation.messages.at(-1);
      setToast(latest?.isDemo ? "Reply simulated in Trial mode" : "Human reply accepted by the live provider");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Reply could not be sent");
    }
  };

  const updateConversation = async (status: Conversation["status"]) => {
    if (!activeConversation) return;
    try {
      await request(`/conversations/${activeConversation}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      await reload(true);
      setToast(status === "CLOSED" ? "Conversation resolved" : status === "ESCALATED" ? "Conversation handed to your team" : "Conversation reopened");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Conversation status could not be changed");
    }
  };

  const moveLead = async (leadId: string, status: LeadStage) => {
    try {
      await request(`/leads/${leadId}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      await reload(true);
      setToast(`Lead moved to ${status.toLowerCase()}`);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Lead could not be moved");
    }
  };

  const updateProduct = async (product: Product, changes: Partial<Product>) => {
    try {
      await request(`/products/${product.id}`, { method: "PATCH", body: JSON.stringify(changes) });
      await reload(true);
      setToast(changes.isActive === false ? "Offer paused" : "Offer updated");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Offer could not be updated");
    }
  };

  const deleteProduct = async (product: Product) => {
    if (!window.confirm(`Remove ${product.name} from your offer library?`)) return;
    try {
      await request(`/products/${product.id}`, { method: "DELETE" });
      await finishAction("Offer removed");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Offer could not be removed");
    }
  };

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      await request("/business-profile", { method: "PUT", body: JSON.stringify({
        businessName: values.businessName,
        category: values.category,
        website: values.website,
        phone: values.phone,
        email: values.email,
        address: values.address,
        timezone: values.timezone,
        aiInstructions: values.aiInstructions,
      }) });
      await reload(true);
      setToast("Business profile saved");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Settings could not be saved");
    }
  };

  const createAgent = async (agent: Pick<Agent, "name" | "description" | "instructions" | "isDefault">) => {
    try {
      await request("/agents", { method: "POST", body: JSON.stringify(agent) });
      await reload(true);
      setToast("AI agent created");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Agent could not be created");
      throw error;
    }
  };

  const updateAgent = async (id: string, changes: Partial<Agent>) => {
    try {
      await request(`/agents/${id}`, { method: "PATCH", body: JSON.stringify(changes) });
      await reload(true);
      setToast("Agent settings saved");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Agent could not be updated");
    }
  };

  const deleteAgent = async (agent: Agent) => {
    if (!window.confirm(`Delete the ${agent.name} agent? Existing conversations keep their history.`)) return;
    try {
      await request(`/agents/${agent.id}`, { method: "DELETE" });
      await reload(true);
      setToast("Agent deleted");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Agent could not be deleted");
    }
  };

  const createWorkflow = async (workflow: Pick<AutomationWorkflow, "name" | "description" | "trigger" | "conditions" | "actions">) => {
    try {
      await request("/automations", { method: "POST", body: JSON.stringify(workflow) });
      await reload(true);
      setToast("Automation workflow created");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Workflow could not be created");
      throw error;
    }
  };

  const updateWorkflow = async (id: string, changes: Partial<AutomationWorkflow>) => {
    try {
      await request(`/automations/${id}`, { method: "PATCH", body: JSON.stringify(changes) });
      await reload(true);
      setToast("Workflow settings saved");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Workflow could not be updated");
    }
  };

  const deleteWorkflow = async (workflow: AutomationWorkflow) => {
    if (!window.confirm(`Delete the ${workflow.name} workflow and its run history?`)) return;
    try {
      await request(`/automations/${workflow.id}`, { method: "DELETE" });
      await reload(true);
      setToast("Workflow deleted");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Workflow could not be deleted");
    }
  };

  const sendChannelMessage = async (message: { contactId: string; channel: "WHATSAPP" | "SMS" | "EMAIL"; content: string; subject?: string }) => {
    try {
      const result = await request<{ conversationId: string; message: { isDemo: boolean } }>("/channels/send", { method: "POST", body: JSON.stringify(message) });
      await reload(true);
      setActiveConversation(result.conversationId);
      setView("inbox");
      setToast(result.message.isDemo ? "Message simulated in Trial mode" : "Provider accepted the message");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Message was not sent");
      throw error;
    }
  };

  const startTelecall = async (call: { contactId: string; agentId?: string }) => {
    try {
      const result = await request<{ callSid: string; demo?: boolean }>("/telecalling/calls", { method: "POST", body: JSON.stringify(call) });
      await reload(true);
      if (result.demo && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance("This is a trial voice demo. No phone call was placed."));
      }
      setToast(result.demo ? "Voice demo simulated in this browser" : `Live call started · ${result.callSid}`);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Call could not be started");
      throw error;
    }
  };

  const activeView = NAV_ITEMS.find((item) => item.id === view) ?? NAV_ITEMS[0];
  const openConversations = snapshot.conversations.filter((conversation) => conversation.status !== "CLOSED");
  const selectedConversation = snapshot.conversations.find((conversation) => conversation.id === activeConversation);
  const filteredContacts = snapshot.contacts.filter((contact) => `${contact.name} ${contact.company ?? ""} ${contact.email ?? ""} ${contact.phone ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const filteredLeads = snapshot.leads.filter((lead) => `${lead.contact.name} ${lead.source ?? ""} ${lead.status}`.toLowerCase().includes(query.toLowerCase()));
  const filteredConversations = openConversations.filter((conversation) => `${conversation.contact.name} ${conversation.messages?.[0]?.content ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  if (booting) {
    return <main className="boot-screen"><AppMark /><span>Waking up your workspace</span><i /></main>;
  }

  if (!token || !session) {
    return (
      <main className="auth-shell">
        <section className="auth-art">
          <div className="auth-art-top"><AppMark /><span>TECHIESEE</span></div>
          <div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit orbit-three" />
          <div className="auth-art-copy"><span className="eyebrow">THE BUSINESS OPERATING SYSTEM</span><h1>Make every<br />conversation<br /><em>count.</em></h1><p>One calm command center for your leads, conversations, and the work that moves business forward.</p></div>
          <div className="auth-art-foot"><span>AI THAT KNOWS YOUR BUSINESS</span><span>01 — 07 / LIVE MODULES</span></div>
        </section>
        <section className="auth-panel">
          <div className="auth-mobile-brand"><AppMark /><span>TECHIESEE</span></div>
          <div className="auth-form-wrap">
              <span className="eyebrow">{authMode === "login" ? "GOOD TO HAVE YOU BACK" : authMode === "register" ? "YOUR NEXT CHAPTER STARTS HERE" : "SECURE ACCOUNT RECOVERY"}</span>
              <h2>{authMode === "login" ? "Sign in to your workspace" : authMode === "register" ? "Build your workspace" : authMode === "forgot" ? "Reset your password" : "Choose a new password"}</h2>
              <p className="auth-subtitle">{authMode === "login" ? "Secure access for your team and customer data." : authMode === "register" ? "Verify your email to activate your secure workspace." : authMode === "forgot" ? "We’ll email you a one-time password reset link." : "Choose a strong password with at least 12 characters."}</p>
              <form className="auth-form" onSubmit={handleAuth}>
                {authMode === "register" && <Field label="Your name" name="name" placeholder="Your name" required />}
                {authMode === "register" && <Field label="Business name" name="businessName" placeholder="Your business" required />}
                {authMode !== "reset" && <Field label="Email address" name="email" type="email" placeholder="you@company.com" defaultValue={verificationEmail} required />}
                {(authMode === "login" || authMode === "register" || authMode === "reset") && <Field label={authMode === "reset" ? "New password" : "Password"} name="password" type="password" placeholder="At least 12 characters" minLength={authMode === "login" ? undefined : 12} required />}
                {authError && <p className="form-error">{authError}</p>}
                {authNotice && <p className="auth-notice">{authNotice}</p>}
                <button className="button button-dark button-wide" type="submit">{authMode === "register" ? "Create workspace" : authMode === "login" ? "Continue securely" : authMode === "forgot" ? "Send reset link" : "Update password"}<span>↗</span></button>
              </form>
              {authMode === "login" && <button className="text-button auth-toggle" onClick={() => { setAuthMode("forgot"); setAuthError(""); setAuthNotice(""); }}>Forgot password?</button>}
              {authMode === "forgot" && <button className="text-button auth-toggle" onClick={() => { setAuthMode("login"); setAuthError(""); setAuthNotice(""); }}>Back to sign in</button>}
              {authMode === "reset" && <button className="text-button auth-toggle" onClick={() => { setAuthMode("login"); setAuthError(""); setAuthNotice(""); }}>Back to sign in</button>}
              {authMode === "login" && (showResendVerification || authError.toLowerCase().includes("verify your email")) && <button className="text-button auth-toggle" onClick={() => { void request<{ message: string }>("/auth/verification", { method: "POST", body: JSON.stringify({ email: verificationEmail }) }).then((result) => { setAuthNotice(result.message); setAuthError(""); }).catch((error: unknown) => setAuthError(error instanceof Error ? error.message : "Could not resend verification email")); }}>Resend verification email</button>}
              {(authMode === "login" || authMode === "register") && <button className="text-button auth-toggle" onClick={() => { setAuthMode(authMode === "login" ? "register" : "login"); setAuthError(""); setAuthNotice(""); }}>
                {authMode === "login" ? "New here? Create a workspace" : "Already have a workspace? Sign in"}
              </button>
              }
          </div>
          <div className="auth-panel-foot"><span>PRIVATE BY DESIGN</span><span>© 2026 TECHIESEE</span></div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><AppMark /><span>TECHIESEE<small>BUSINESS WORKSPACE</small></span></div>
        <div className="workspace-switcher"><div className="workspace-avatar">{initials(session.organization.name)}</div><div className="workspace-name"><strong>{session.organization.name}</strong><span>{session.role.toLowerCase()} workspace</span></div><span className={`status-chip ${session.organization.mode === "LIVE" ? "status-open" : "status-escalated"}`}>{session.organization.mode ?? "TRIAL"}</span></div>
        <div className="side-label">WORKSPACE <span>⌘ K</span></div>
        <nav className="main-nav" aria-label="Workspace sections">
          {NAV_ITEMS.map((item) => <button key={item.id} className={`nav-item ${view === item.id ? "active" : ""}`} onClick={() => { setView(item.id); setQuery(""); }}><span className="nav-index">{item.index}</span><span>{item.label}</span>{item.id === "inbox" && openConversations.length > 0 && <b className="nav-count">{openConversations.length}</b>}</button>)}
        </nav>
        <div className="sidebar-spacer" />
        <div className="connection-card"><div className="connection-heading"><span className={`connection-dot ${snapshot.whatsapp?.connected ? "is-live" : ""}`} /><span>WHATSAPP CHANNEL</span></div><strong>{snapshot.whatsapp?.connected ? "Connected" : "Demo mode"}</strong><p>{snapshot.whatsapp?.connected ? "Live conversations are flowing." : "Try the assistant with a sample message."}</p><button onClick={() => snapshot.whatsapp?.connected ? setView("settings") : setModal("simulate")}>{snapshot.whatsapp?.connected ? "View connection" : "Run a simulation"}<span>↗</span></button></div>
        <div className="sidebar-foot"><button className="user-chip" onClick={signOut}><span className="user-avatar">{initials(session.user.name)}</span><span><strong>{session.user.name}</strong><small>{session.user.email}</small></span><span className="user-menu">···</span></button></div>
      </aside>

      <section className="main-area">
        <header className="topbar"><div className="breadcrumb"><span>WORKSPACE</span><b>/</b><strong>{activeView.label.toUpperCase()}</strong></div><div className="topbar-actions"><label className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this view" aria-label="Search this view" /><kbd>⌘ /</kbd></label><button className="icon-button refresh-button" onClick={() => void reload()} title="Refresh workspace" aria-label="Refresh workspace">{refreshing ? <span className="spin">◌</span> : "↻"}</button><button className="top-avatar" onClick={signOut} title="Sign out">{initials(session.user.name)}</button></div></header>

        <div key={view} className="page-content">
          <div className="page-heading"><div><span className="eyebrow">BUSINESS OPERATIONS <i className="live-pulse" /> <b className={`status-chip ${session.organization.mode === "LIVE" ? "status-open" : "status-escalated"}`}>{session.organization.mode ?? "TRIAL"} MODE</b></span><h1>{view === "overview" ? <>Good things are <em>in motion.</em></> : activeView.label}</h1><p>{view === "overview" ? "Here’s the shape of your business today." : view === "inbox" ? "Every customer conversation, in one thoughtful place." : view === "pipeline" ? "Momentum, made visible from first hello to closed deal." : view === "contacts" ? "The people behind every good business relationship." : view === "appointments" ? "Your upcoming commitments, all in one view." : view === "catalog" ? "The services and products your AI can quote confidently." : view === "agents" ? "Configure the AI employees that represent your business." : view === "automations" ? "Turn CRM events into reliable, trackable actions." : view === "channels" ? "Start customer conversations with demo or live providers, based on this workspace’s mode." : "Give your AI the context to represent your business well."}</p></div><div className="heading-actions"><span className="sync-status"><i /> SYNCED JUST NOW</span>{view === "contacts" && <button className="button button-acid" onClick={() => setModal("contact")}>+ Add contact</button>}{view === "catalog" && <button className="button button-acid" onClick={() => setModal("product")}>+ Add an offer</button>}{view === "inbox" && <button className="button button-dark" onClick={() => setModal("simulate")}>＋ Simulate a message</button>}</div></div>

          {pageError && <div className="notice-banner"><span>!</span><p>{pageError}</p><button onClick={() => setPageError("")} aria-label="Dismiss">×</button></div>}
          {snapshot.errors.length > 0 && snapshot.errors.length < 7 && <div className="partial-notice">Some workspace modules could not load. Check that your backend is up at <code>localhost:4000</code>.</div>}

          {view === "overview" && <Overview snapshot={snapshot} now={now} setView={setView} onSimulate={() => setModal("simulate")} />}
          {view === "inbox" && <Inbox conversations={filteredConversations} selected={selectedConversation} onSelect={setActiveConversation} onReply={sendReply} reply={reply} setReply={setReply} onStatus={updateConversation} />}
          {view === "pipeline" && <Pipeline leads={filteredLeads} canCreateLead={snapshot.contacts.length > 0} onAdd={() => setModal("lead")} onMove={moveLead} />}
          {view === "contacts" && <Contacts contacts={filteredContacts} onAdd={() => setModal("contact")} />}
          {view === "appointments" && <Appointments appointments={snapshot.appointments} />}
          {view === "catalog" && <Catalog products={snapshot.products} onAdd={() => setModal("product")} onToggle={updateProduct} onDelete={deleteProduct} />}
          {view === "agents" && <AgentsPanel agents={snapshot.agents} onCreate={createAgent} onUpdate={updateAgent} onDelete={deleteAgent} />}
          {view === "automations" && <AutomationsPanel workflows={snapshot.workflows} runs={snapshot.automationRuns} onCreate={createWorkflow} onUpdate={updateWorkflow} onDelete={deleteWorkflow} />}
          {view === "channels" && <ChannelsPanel contacts={snapshot.contacts} agents={snapshot.agents} availability={snapshot.channelAvailability} onSend={sendChannelMessage} onCall={startTelecall} />}
          {view === "settings" && <div className="settings-stack"><Settings profile={snapshot.profile} whatsapp={snapshot.whatsapp} onSave={saveProfile} /><PlatformModeControl visible={!!session.isPlatformAdmin} onModeChanged={handlePlatformModeChange} /></div>}

          <footer className="page-footer"><span>TECHIESEE <b>·</b> BUILT TO KEEP THE HUMAN IN THE LOOP</span><span>WORKSPACE STATUS <i className="live-pulse" /> OPERATIONAL</span></footer>
        </div>
      </section>

      {miraOpen && <MiraPanel snapshot={snapshot} view={view} token={token} onClose={() => setMiraOpen(false)} />}
      {!miraOpen && <button className="mira-launcher" onClick={() => setMiraOpen(true)} aria-label="Open Mira business assistant"><span className="mira-orb"><AppMark /></span><span><strong>Mira</strong><small>Ask your advisor</small></span><b>↗</b></button>}
      {modal && <ActionModal kind={modal} contacts={snapshot.contacts} onClose={() => setModal(null)} onSubmit={submitModal} />}
      {toast && <div className="toast-message"><span>✓</span>{toast}</div>}
    </main>
  );
}

function Field({ label, name, type = "text", placeholder, defaultValue, required, minLength, min }: { label: string; name: string; type?: string; placeholder?: string; defaultValue?: string | number | null; required?: boolean; minLength?: number; min?: number }) {
  return <label className="field"><span>{label}</span><input name={name} type={type} placeholder={placeholder} defaultValue={defaultValue ?? ""} required={required} minLength={minLength} min={min} /></label>;
}

function Overview({ snapshot, now, setView, onSimulate }: { snapshot: Snapshot; now: number; setView: (view: ViewId) => void; onSimulate: () => void }) {
  const openCount = snapshot.conversations.filter((conversation) => conversation.status !== "CLOSED").length;
  const wonValue = snapshot.leads.filter((lead) => lead.status === "WON").reduce((sum, lead) => sum + (lead.value ?? 0), 0);
  const newLeads = snapshot.leads.filter((lead) => lead.status === "NEW").length;
  const nextAppointment = snapshot.appointments.find((appointment) => new Date(appointment.scheduledAt).getTime() >= now && appointment.status === "SCHEDULED");
  const recent = [...snapshot.conversations].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 4);
  const bars = [34, 48, 41, 63, 53, 76, 59, 84, 66, 96, 73, 89];

  return (
    <div className="overview-grid">
      <section className="welcome-panel"><div className="welcome-noise" /><div className="welcome-copy"><span className="eyebrow">YOUR AI OPERATOR IS ON</span><h2>Less busywork.<br /><em>More business.</em></h2><p>Conversations are captured, leads are moving, and your AI is ready to help.</p><button className="button button-paper" onClick={onSimulate}>Start a WhatsApp demo <span>↗</span></button></div><div className="welcome-orbit"><div className="orbit-core"><AppMark /></div><span className="orbit-tag tag-one">LISTEN</span><span className="orbit-tag tag-two">LEARN</span><span className="orbit-tag tag-three">RESPOND</span></div><div className="welcome-caption"><span>01 / BUSINESS SIGNAL</span><span>ALWAYS ON <i /></span></div></section>

      <section className="metrics-grid">
        <Metric label="ACTIVE LEADS" value={snapshot.leads.length} detail={`${newLeads} new to follow up`} tone="metric-mint" chart="▁▂▂▃▅▄▆▇" />
        <Metric label="LIVE CONVERSATIONS" value={openCount} detail={`${snapshot.conversations.filter((item) => item.status === "ESCALATED").length} need a human`} tone="metric-peach" chart="▂▃▁▄▅▃▆▇" />
        <Metric label="UPCOMING BOOKINGS" value={snapshot.appointments.filter((item) => item.status === "SCHEDULED").length} detail="AI can book from chat" tone="metric-sky" chart="▁▃▂▅▃▆▄▇" />
        <Metric label="WON REVENUE" value={money(wonValue)} detail="From tracked opportunities" tone="metric-lilac" chart="▂▁▃▂▄▅▆▇" />
      </section>

      <section className="panel activity-panel"><div className="panel-heading"><div><span className="eyebrow">THE LAST 7 DAYS</span><h3>Business pulse</h3></div><span className="panel-index">01—07</span></div><div className="pulse-chart"><div className="chart-labels"><span>HIGH</span><span>FLOW</span><span>LOW</span></div><div className="chart-lines"><i /><i /><i /><div className="bar-row">{bars.map((height, index) => <span key={index} style={{ height: `${height}%`, animationDelay: `${index * 45}ms` }} className={index === 9 ? "bar-highlight" : ""} />)}</div></div></div><div className="chart-foot"><span><i className="legend-dot" /> CUSTOMER TOUCHPOINTS</span><span>LIVE DATA · {snapshot.conversations.length} TOTAL</span></div></section>

      <section className="panel focus-panel"><div className="panel-heading"><div><span className="eyebrow">YOUR NEXT MOVE</span><h3>On the radar</h3></div><span className="radar-mark">◎</span></div>{nextAppointment ? <div className="next-booking"><span className="booking-date">{new Date(nextAppointment.scheduledAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span><div><strong>{nextAppointment.service}</strong><span>{nextAppointment.contact.name} · {shortDate(nextAppointment.scheduledAt)}</span></div><span className="booking-status">UP NEXT</span></div> : <div className="empty-focus"><span className="empty-ring">＋</span><strong>A little room to grow</strong><p>New bookings made by your AI will appear here.</p><button className="text-button" onClick={() => setView("appointments")}>Open appointments ↗</button></div>}<div className="focus-bottom"><span>OFFER LIBRARY</span><strong>{snapshot.products.filter((product) => product.isActive).length} active offers</strong><button className="text-button" onClick={() => setView("catalog")}>Manage ↗</button></div></section>

      <section className="panel recent-panel"><div className="panel-heading"><div><span className="eyebrow">FRESH FROM THE INBOX</span><h3>Latest conversations</h3></div><button className="text-button" onClick={() => setView("inbox")}>Open inbox ↗</button></div>{recent.length === 0 ? <EmptyState title="Your inbox is ready" detail="Start a WhatsApp simulation to see your assistant work." action="Try the simulator" onAction={onSimulate} /> : <div className="recent-list">{recent.map((conversation) => <button className="recent-row" key={conversation.id} onClick={() => setView("inbox")}><span className="person-avatar">{initials(conversation.contact.name)}</span><span className="recent-person"><strong>{conversation.contact.name}</strong><small>{conversation.messages?.[0]?.content ?? "No messages yet"}</small></span><span className={`status-chip status-${conversation.status.toLowerCase()}`}>{conversation.status}</span><span className="recent-time">{relativeTime(conversation.updatedAt)}</span></button>)}</div>}</section>

      <section className="panel quick-panel"><div className="panel-heading"><div><span className="eyebrow">QUICK ACCESS</span><h3>Jump back in</h3></div></div><button className="quick-link" onClick={() => setView("pipeline")}><span className="quick-icon icon-orange">↗</span><span><strong>Lead pipeline</strong><small>{snapshot.leads.length} opportunities in play</small></span><b>→</b></button><button className="quick-link" onClick={() => setView("contacts")}><span className="quick-icon icon-green">◎</span><span><strong>People directory</strong><small>{snapshot.contacts.length} relationships</small></span><b>→</b></button><button className="quick-link" onClick={() => setView("settings")}><span className="quick-icon icon-blue">✳</span><span><strong>Teach your AI</strong><small>Set your voice and business facts</small></span><b>→</b></button></section>
    </div>
  );
}

function EmptyState({ title, detail, action, onAction }: { title: string; detail: string; action?: string; onAction?: () => void }) {
  return <div className="empty-state"><span className="empty-spark">✳</span><strong>{title}</strong><p>{detail}</p>{action && onAction && <button className="text-button" onClick={onAction}>{action} ↗</button>}</div>;
}

function Inbox({ conversations, selected, onSelect, onReply, reply, setReply, onStatus }: { conversations: Conversation[]; selected?: Conversation; onSelect: (id: string) => void; onReply: (event: FormEvent<HTMLFormElement>) => void; reply: string; setReply: (value: string) => void; onStatus: (status: Conversation["status"]) => void }) {
  return <section className="inbox-layout"><aside className="inbox-list"><div className="inbox-list-head"><div><span className="eyebrow">CUSTOMER CARE</span><h3>All conversations</h3></div><span className="inbox-total">{conversations.length}</span></div><div className="inbox-filters"><span className="filter-active">All open</span><span>Assigned to me</span></div>{conversations.length === 0 ? <EmptyState title="The room is quiet" detail="Your new conversations will show up here." /> : conversations.map((conversation) => { const latest = conversation.messages?.[0]; return <button key={conversation.id} onClick={() => onSelect(conversation.id)} className={`conversation-item ${selected?.id === conversation.id ? "selected" : ""}`}><span className="person-avatar">{initials(conversation.contact.name)}</span><span className="conversation-copy"><span className="conversation-title"><strong>{conversation.contact.name}</strong><small>{relativeTime(conversation.updatedAt)}</small></span><span className="conversation-preview">{latest?.content ?? "No messages"}</span><span className="conversation-meta"><span className="channel-pill">{conversation.channel}</span><span className={`status-chip status-${conversation.status.toLowerCase()}`}>{conversation.status}</span></span></span></button>; })}</aside>
    <section className="message-panel">{selected ? <><header className="message-header"><div className="message-contact"><span className="person-avatar avatar-large">{initials(selected.contact.name)}</span><div><strong>{selected.contact.name}</strong><span>{selected.contact.phone ?? selected.contact.email ?? selected.channel}</span></div></div><div className="message-actions"><span className={`status-chip status-${selected.status.toLowerCase()}`}>{selected.status}</span>{selected.status === "ESCALATED" ? <button className="button button-outline" onClick={() => onStatus("OPEN")}>Reopen AI</button> : <button className="button button-outline" onClick={() => onStatus("ESCALATED")}>Take over</button>}{selected.status !== "CLOSED" && <button className="icon-button resolve-button" onClick={() => onStatus("CLOSED")} title="Resolve conversation" aria-label="Resolve conversation">✓</button>}</div></header><div className="message-stream"><div className="stream-date">{new Date(selected.updatedAt).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</div>{selected.messages?.map((message) => <div key={message.id} className={`message-row ${message.sender === "CUSTOMER" ? "from-customer" : "from-team"}`}><div className="message-bubble"><span className="message-sender">{message.sender === "AI" ? "TECHIESEE AI" : message.sender === "HUMAN" ? "YOUR TEAM" : selected.contact.name.toUpperCase()}</span><p>{message.content}</p><span className="message-time">{new Date(message.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}{message.isDemo && <i> · DEMO</i>}</span></div></div>)}</div><form className="reply-composer" onSubmit={onReply}><textarea aria-label="Write a reply" placeholder={selected.status === "CLOSED" ? "Reopen this conversation to reply" : "Write a thoughtful reply…"} value={reply} onChange={(event) => setReply(event.target.value)} disabled={selected.status === "CLOSED"} /><div className="composer-foot"><span>HUMAN REPLY <b>·</b> AI PAUSED AFTER TAKEOVER</span><button className="button button-dark" type="submit" disabled={!reply.trim() || selected.status === "CLOSED"}>Send reply <span>↗</span></button></div></form></> : <div className="no-selection"><span className="empty-ring">↖</span><h3>Choose a conversation</h3><p>Select a customer from the list to read and reply.</p></div>}</section></section>;
}

function Pipeline({ leads, canCreateLead, onAdd, onMove }: { leads: Lead[]; canCreateLead: boolean; onAdd: () => void; onMove: (id: string, stage: LeadStage) => void }) {
  const [dragging, setDragging] = useState("");
  const stageLabels: Record<LeadStage, string> = { NEW: "New", CONTACTED: "Contacted", QUALIFIED: "Qualified", PROPOSAL: "Proposal", NEGOTIATION: "Negotiation", WON: "Won", LOST: "Lost" };
  return <section className="pipeline-wrap"><div className="pipeline-toolbar"><span>{canCreateLead ? "Every new opportunity starts with a contact." : "Add a contact first to create a lead."}</span><button className="button button-acid" onClick={onAdd} disabled={!canCreateLead}>+ Add lead</button></div><div className="pipeline-summary"><span><b>{leads.length}</b> active opportunities</span><span>DRAG A CARD TO MOVE IT <i>↗</i></span><span className="pipeline-value">{money(leads.reduce((total, lead) => total + (lead.value ?? 0), 0))} <small>PIPELINE VALUE</small></span></div><div className="pipeline-board">{LEAD_STAGES.map((stage, index) => { const stageLeads = leads.filter((lead) => lead.status === stage); const total = stageLeads.reduce((sum, lead) => sum + (lead.value ?? 0), 0); return <div key={stage} className={`pipeline-column column-${stage.toLowerCase()} ${dragging ? "drag-active" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData("text/plain"); if (id) onMove(id, stage); setDragging(""); }}><div className="column-heading"><span className="column-number">0{index + 1}</span><strong>{stageLabels[stage]}</strong><b>{stageLeads.length}</b></div><div className="column-total">{money(total)}</div><div className="lead-cards">{stageLeads.map((lead) => <article key={lead.id} className="lead-card" draggable onDragStart={(event) => { event.dataTransfer.setData("text/plain", lead.id); setDragging(lead.id); }} onDragEnd={() => setDragging("")}><div className="lead-card-top"><span className="person-avatar">{initials(lead.contact.name)}</span><span className="lead-score">{lead.score} <small>PTS</small></span></div><strong>{lead.contact.name}</strong><span className="lead-company">{lead.contact.company || lead.source || "New relationship"}</span><div className="lead-card-foot"><span>{money(lead.value)}</span><span>{lead.source ?? "MANUAL"}</span></div><label className="move-select"><span>MOVE TO</span><select aria-label={`Move ${lead.contact.name} to another stage`} value={lead.status} onChange={(event) => onMove(lead.id, event.target.value as LeadStage)}>{LEAD_STAGES.map((option) => <option key={option} value={option}>{stageLabels[option]}</option>)}</select></label></article>)}</div></div>; })}</div></section>;
}

function Contacts({ contacts, onAdd }: { contacts: Contact[]; onAdd: () => void }) {
  return <section className="panel table-panel"><div className="table-toolbar"><div><span className="eyebrow">YOUR CUSTOMER GRAPH</span><h3>{contacts.length} people in your orbit</h3></div><button className="button button-acid" onClick={onAdd}>+ Add contact</button></div>{contacts.length === 0 ? <EmptyState title="Start with one good relationship" detail="Add a contact here, or let a new conversation create one for you." action="Add your first contact" onAction={onAdd} /> : <div className="table-scroll"><table><thead><tr><th>PERSON</th><th>COMPANY</th><th>CONTACT DETAILS</th><th>TAGS</th><th>ADDED</th></tr></thead><tbody>{contacts.map((contact) => <tr key={contact.id}><td><span className="table-person"><span className="person-avatar">{initials(contact.name)}</span><strong>{contact.name}</strong></span></td><td>{contact.company || <span className="muted">Independent</span>}</td><td><span className="contact-details">{contact.phone && <span>{contact.phone}</span>}{contact.email && <span>{contact.email}</span>}{!contact.phone && !contact.email && <span className="muted">No details yet</span>}</span></td><td><span className="tag-list">{contact.tags?.length ? contact.tags.map((tag) => <i key={tag}>{tag}</i>) : <span className="muted">—</span>}</span></td><td>{new Date(contact.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" })}</td></tr>)}</tbody></table></div>}</section>;
}

function Appointments({ appointments }: { appointments: Appointment[] }) {
  const ordered = [...appointments].sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  return <section className="appointment-view"><div className="appointment-intro"><div><span className="eyebrow">BOOKED BY YOUR AI</span><h2>Time set aside<br /><em>for good work.</em></h2><p>These bookings are created when your assistant confirms a real appointment in a conversation.</p></div><div className="appointment-count"><strong>{appointments.filter((item) => item.status === "SCHEDULED").length.toString().padStart(2, "0")}</strong><span>SCHEDULED<br />APPOINTMENTS</span></div></div><div className="appointment-list">{ordered.length === 0 ? <EmptyState title="Your calendar is open" detail="Appointments booked through conversations will land here automatically." /> : ordered.map((appointment) => <article key={appointment.id} className="appointment-row"><div className="appointment-date"><strong>{new Date(appointment.scheduledAt).toLocaleDateString("en-IN", { day: "2-digit" })}</strong><span>{new Date(appointment.scheduledAt).toLocaleDateString("en-IN", { month: "short" }).toUpperCase()}</span></div><div className="appointment-detail"><strong>{appointment.service}</strong><span>{appointment.contact.name} {appointment.contact.phone ? `· ${appointment.contact.phone}` : ""}</span></div><div className="appointment-time"><strong>{new Date(appointment.scheduledAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</strong><span>{appointment.durationMin} MIN</span></div><span className={`status-chip status-${appointment.status.toLowerCase()}`}>{appointment.status}</span></article>)}</div><p className="read-only-note">Bookings can be created by the AI during a conversation. Manual create, edit, and cancel controls are not available in the current backend.</p></section>;
}

function Catalog({ products, onAdd, onToggle, onDelete }: { products: Product[]; onAdd: () => void; onToggle: (product: Product, changes: Partial<Product>) => void; onDelete: (product: Product) => void }) {
  return <section className="catalog-view"><div className="catalog-banner"><div><span className="eyebrow">ACCURATE ANSWERS START HERE</span><h2>Your AI quotes<br /><em>what you actually offer.</em></h2><p>Active offers become the assistant’s trusted source for pricing and service details.</p></div><div className="catalog-stamp"><span>THE</span><strong>REAL<br />PRICE</strong><span>MATTERS</span></div></div><div className="catalog-header"><div><span className="eyebrow">OFFER LIBRARY</span><h3>{products.length} offers <span>·</span> {products.filter((product) => product.isActive).length} active</h3></div><button className="button button-dark" onClick={onAdd}>+ New offer</button></div>{products.length === 0 ? <div className="panel"><EmptyState title="Give your AI something to sell" detail="Add a product or service so your assistant can answer pricing questions accurately." action="Create an offer" onAction={onAdd} /></div> : <div className="product-grid">{products.map((product, index) => <article className={`product-card product-card-${index % 3} ${!product.isActive ? "product-paused" : ""}`} key={product.id}><div className="product-card-top"><span className="product-category">{product.category || "SERVICE"}</span><button className="product-menu" onClick={() => onDelete(product)} title={`Delete ${product.name}`} aria-label={`Delete ${product.name}`}>···</button></div><div className="product-art" aria-hidden="true"><span className="product-sun" /><span className="product-line line-a" /><span className="product-line line-b" /><span className="product-line line-c" /><span className="product-art-code">0{index + 1}</span></div><div className="product-info"><h4>{product.name}</h4><p>{product.description || "A clear, confident offer ready for your assistant to share."}</p><div className="product-price"><strong>{money(product.price)}</strong>{product.durationMin && <span>{product.durationMin} MIN</span>}</div><div className="product-footer"><span className={`product-state ${product.isActive ? "" : "paused"}`}><i />{product.isActive ? "AI CAN QUOTE" : "PAUSED"}</span><button className="text-button" onClick={() => onToggle(product, { isActive: !product.isActive })}>{product.isActive ? "Pause offer" : "Activate"}</button></div></div></article>)}</div>}</section>;
}

function Settings({ profile, whatsapp, onSave }: { profile: BusinessProfile | null; whatsapp: Snapshot["whatsapp"]; onSave: (event: FormEvent<HTMLFormElement>) => void }) {
  return <section className="settings-layout"><div className="settings-main"><div className="panel settings-panel"><div className="panel-heading"><div><span className="eyebrow">YOUR BUSINESS, IN YOUR WORDS</span><h3>Business profile</h3></div><span className="settings-symbol">✳</span></div><p className="settings-intro">This information grounds every answer your AI gives. Keep it real, specific, and unmistakably yours.</p><form className="settings-form" onSubmit={onSave}><div className="form-grid"><Field label="Business name" name="businessName" defaultValue={profile?.businessName} required /><Field label="Category" name="category" placeholder="e.g. Fitness studio" defaultValue={profile?.category} /><Field label="Website" name="website" placeholder="https://" defaultValue={profile?.website} /><Field label="Business phone" name="phone" placeholder="+91" defaultValue={profile?.phone} /><Field label="Business email" name="email" type="email" placeholder="hello@business.com" defaultValue={profile?.email} /><Field label="Timezone" name="timezone" placeholder="Asia/Kolkata" defaultValue={profile?.timezone} /><label className="field field-span"><span>Business address</span><input name="address" placeholder="Street, city, region" defaultValue={profile?.address ?? ""} /></label><label className="field field-span"><span>Teach your AI</span><textarea name="aiInstructions" rows={7} placeholder="Your services, pricing, policies, tone of voice, and the questions customers ask most…" defaultValue={profile?.aiInstructions ?? ""} /><small>Be precise. Your assistant is instructed not to invent information that is not written here.</small></label></div><div className="settings-submit"><span>REAL INTEGRATIONS ARE CONFIGURED BY A PLATFORM ADMIN WHEN ACTIVATING LIVE</span><button className="button button-dark" type="submit">Save business profile <span>↗</span></button></div></form></div></div>
    <aside className="settings-side"><div className="connection-detail"><span className="eyebrow">CHANNEL STATUS</span><div className={`whatsapp-mark ${whatsapp?.connected ? "connected" : ""}`}>W</div><h3>WhatsApp<br /><em>{whatsapp?.connected ? "is connected." : "is in demo mode."}</em></h3><p>{whatsapp?.connected ? "Live customer messages can reach your AI operator." : "Test the full AI conversation flow here. Live delivery needs Meta credentials on the backend."}</p><div className="channel-check"><span>SERVER CREDENTIALS</span><b className={whatsapp?.serverConfigured ? "check-on" : "check-off"}>{whatsapp?.serverConfigured ? "READY" : "NOT SET"}</b></div><div className="channel-check"><span>BUSINESS NUMBER LINKED</span><b className={whatsapp?.numberLinked ? "check-on" : "check-off"}>{whatsapp?.numberLinked ? "LINKED" : "NOT SET"}</b></div><a className="text-button setup-link" href="https://developers.facebook.com/docs/whatsapp/cloud-api" target="_blank" rel="noreferrer">WhatsApp Cloud API guide ↗</a></div><div className="settings-privacy"><span className="eyebrow">BUILT WITH CARE</span><strong>Your customer data stays scoped to this workspace.</strong><p>Every CRM request is authenticated and filtered by your organization.</p></div></aside></section>;
}

type PlatformOrganization = {
  id: string;
  name: string;
  slug: string;
  mode: "TRIAL" | "LIVE";
  status: "ACTIVE" | "SUSPENDED";
  trialEndsAt: string | null;
  trialSettings: {
    trialDurationDays: number;
    maxWhatsAppDemoMessages: number;
    maxSmsDemoMessages: number;
    maxEmailDemoMessages: number;
    maxVoiceDemoMessages: number;
    maxUsers: number;
    enabledFeatures: string[];
  } | null;
  subscriptions: { plan: string; status: string; endsAt: string | null }[];
  integrations: { whatsappPhoneNumberId: string; twilioPhoneNumber: string; outboundEmail: string };
  channels: { whatsapp: boolean; sms: boolean; voice: boolean; email: boolean; ai: boolean; demo: boolean };
};

const DEFAULT_TRIAL_SETTINGS = {
  trialDurationDays: 14,
  maxWhatsAppDemoMessages: 100,
  maxSmsDemoMessages: 100,
  maxEmailDemoMessages: 50,
  maxVoiceDemoMessages: 30,
  maxUsers: 3,
  enabledFeatures: ["CRM", "AI", "AUTOMATIONS", "MESSAGING", "VOICE"],
};

function PlatformModeControl({ visible, onModeChanged }: { visible: boolean; onModeChanged: (organizationId: string, mode: "TRIAL" | "LIVE" | "SUSPENDED") => void }) {
  const [organizations, setOrganizations] = useState<PlatformOrganization[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [requestedMode, setRequestedMode] = useState<"TRIAL" | "LIVE" | "SUSPENDED">("LIVE");
  const [planNotice, setPlanNotice] = useState("");
  const selected = organizations.find((organization) => organization.id === selectedId);

  const reload = async () => {
    const result = await request<{ organizations: PlatformOrganization[] }>("/admin/organizations");
    setOrganizations(result.organizations);
    const nextId = selectedId || result.organizations[0]?.id || "";
    setSelectedId(nextId);
    const nextOrganization = result.organizations.find((organization) => organization.id === nextId);
    if (nextOrganization) {
      setRequestedMode(nextOrganization.status === "SUSPENDED"
        ? nextOrganization.mode
        : nextOrganization.mode === "LIVE" ? "SUSPENDED" : "LIVE");
    }
  };

  useEffect(() => {
    if (!visible) return;
    let active = true;
    void request<{ organizations: PlatformOrganization[] }>("/admin/organizations")
      .then((result) => {
        if (!active) return;
        setOrganizations(result.organizations);
        const first = result.organizations[0];
        if (first) {
          setSelectedId(first.id);
          setRequestedMode(first.status === "SUSPENDED" ? first.mode : first.mode === "LIVE" ? "SUSPENDED" : "LIVE");
        }
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load workspaces");
      });
    return () => { active = false; };
  }, [visible]);

  if (!visible) return null;

  const saveIntegrations = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(`/admin/organizations/${selected.id}/integrations`, {
        method: "PUT",
        body: JSON.stringify({
          whatsappPhoneNumberId: values.whatsappPhoneNumberId,
          twilioPhoneNumber: values.twilioPhoneNumber,
          outboundEmail: values.outboundEmail,
        }),
      });
      await reload();
      setNotice("Live integration settings saved. No provider credentials are stored in the database.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Integration settings could not be saved");
    } finally {
      setBusy(false);
    }
  };

  const changeMode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await request<{ message: string }>(`/admin/organizations/${selected.id}/mode`, {
        method: "POST",
        body: JSON.stringify({ mode: values.mode, confirmation: values.confirmation }),
      });
      const targetMode = String(values.mode) as "TRIAL" | "LIVE" | "SUSPENDED";
      setOrganizations((current) => current.map((organization) => organization.id === selected.id
        ? { ...organization, mode: targetMode === "SUSPENDED" ? organization.mode : targetMode, status: targetMode === "SUSPENDED" ? "SUSPENDED" : "ACTIVE" }
        : organization));
      setRequestedMode(targetMode === "SUSPENDED" ? selected.mode : targetMode === "LIVE" ? "SUSPENDED" : "LIVE");
      onModeChanged(selected.id, targetMode);
      setNotice(result.message);
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : "Workspace mode could not be changed");
    } finally {
      setBusy(false);
    }
  };

  const activatePlan = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    setBusy(true);
    setError("");
    setPlanNotice("");
    try {
      await request(`/admin/organizations/${selected.id}/subscription`, {
        method: "POST",
        body: JSON.stringify({
          confirmation: values.confirmation,
          plan: values.plan,
          paymentReference: values.paymentReference || undefined,
        }),
      });
      await reload();
      setPlanNotice("Plan activated and recorded. You can now confirm Live mode.");
    } catch (activationError) {
      setError(activationError instanceof Error ? activationError.message : "Plan could not be activated");
    } finally {
      setBusy(false);
    }
  };

  const extendPlan = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    setBusy(true);
    setError("");
    setPlanNotice("");
    try {
      const parsedDays = Number(values.days ?? 30);
      if (!Number.isFinite(parsedDays) || parsedDays <= 0) throw new Error("Choose a valid extension length in days.");
      await request(`/admin/organizations/${selected.id}/subscription/extend`, {
        method: "POST",
        body: JSON.stringify({
          days: parsedDays,
          confirmation: values.confirmation,
          paymentReference: values.paymentReference || undefined,
        }),
      });
      await reload();
      setPlanNotice(`Plan extended by ${parsedDays} days.`);
    } catch (extendError) {
      setError(extendError instanceof Error ? extendError.message : "Plan could not be extended");
    } finally {
      setBusy(false);
    }
  };

  const saveTrialSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const formData = new FormData(event.currentTarget);
    const values = Object.fromEntries(formData.entries());
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(`/admin/organizations/${selected.id}/trial-settings`, {
        method: "PUT",
        body: JSON.stringify({
          trialDurationDays: Number(values.trialDurationDays),
          maxWhatsAppDemoMessages: Number(values.maxWhatsAppDemoMessages),
          maxSmsDemoMessages: Number(values.maxSmsDemoMessages),
          maxEmailDemoMessages: Number(values.maxEmailDemoMessages),
          maxVoiceDemoMessages: Number(values.maxVoiceDemoMessages),
          maxUsers: Number(values.maxUsers),
          enabledFeatures: formData.getAll("enabledFeatures").map(String),
        }),
      });
      await reload();
      setNotice("Trial limits saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Trial limits could not be saved");
    } finally {
      setBusy(false);
    }
  };

  const settings = selected?.trialSettings ?? DEFAULT_TRIAL_SETTINGS;
  const requiredConfirmation = selected?.status === "SUSPENDED" && requestedMode !== "SUSPENDED"
    ? "RESTORE"
    : requestedMode === "LIVE" ? "ACTIVATE LIVE" : requestedMode === "SUSPENDED" ? "SUSPEND" : "RETURN TO TRIAL";

  return <section className="panel settings-panel platform-admin-panel">
    <div className="panel-heading"><div><span className="eyebrow">PLATFORM ADMIN · SUPER ADMIN ONLY</span><h3>Trial → Live activation</h3></div><span className="settings-symbol">↗</span></div>
    <p className="settings-intro">Select an organization, configure its real sender IDs, then explicitly confirm the per-workspace mode change. Provider secrets remain in backend environment configuration.</p>
    {error && <div className="notice-banner"><span>!</span><p>{error}</p></div>}
    {notice && <div className="partial-notice">{notice}</div>}
    <label className="field"><span>Organization</span><select value={selectedId} onChange={(event) => {
      const id = event.target.value;
      setSelectedId(id);
      const organization = organizations.find((item) => item.id === id);
      if (organization) setRequestedMode(organization.status === "SUSPENDED" ? organization.mode : organization.mode === "LIVE" ? "SUSPENDED" : "LIVE");
    }}>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name} · {organization.mode}{organization.status === "SUSPENDED" ? " · SUSPENDED" : ""}</option>)}</select></label>
    {selected && <>
      <div className="channel-check"><span>LIVE PROVIDER READINESS</span><b>{Object.entries(selected.channels).filter(([key, ready]) => key !== "demo" && ready).map(([key]) => key.toUpperCase()).join(", ") || "NO REAL PROVIDER READY"}</b></div>
      <div className="channel-check"><span>AI PROVIDER</span><b className={selected.channels.ai ? "check-on" : "check-off"}>{selected.channels.ai ? "OPENAI READY" : "NOT CONFIGURED"}</b></div>
      <div className="channel-check"><span>ACTIVE PLAN</span><b>{selected.subscriptions[0] ? `${selected.subscriptions[0].plan}${selected.subscriptions[0].endsAt ? ` · ends ${shortDate(selected.subscriptions[0].endsAt)}` : ""}` : "NO ACTIVE PLAN"}</b></div>
      <form key={`plan-${selected.id}`} className="settings-form" onSubmit={activatePlan}>
        <span className="eyebrow">MANUAL PAYMENT · ACTIVATE PLAN</span>
        <div className="form-grid">
          <label className="field"><span>Plan</span><select name="plan"><option value="MONTHLY">Monthly</option><option value="SIX_MONTHS">6 months</option><option value="SEVEN_MONTHS">7 months</option></select></label>
          <Field label="Payment reference (optional)" name="paymentReference" placeholder="Receipt or transaction reference" />
          <Field label="Type ACTIVATE to confirm" name="confirmation" required />
        </div>
        <div className="settings-submit"><span>ONLY ACTIVATE AFTER PAYMENT IS VERIFIED</span><button className="button button-outline" type="submit" disabled={busy}>Activate plan</button></div>
        {planNotice && <div className="partial-notice">{planNotice}</div>}
      </form>
      <form key={`extend-${selected.id}`} className="settings-form" onSubmit={extendPlan}>
        <span className="eyebrow">PLAN MANAGEMENT · EXTEND OR RENEW</span>
        <div className="form-grid">
          <Field label="Days to extend" name="days" type="number" defaultValue={30} min={1} required />
          <Field label="Type EXTEND to confirm" name="confirmation" required />
          <Field label="Payment reference (optional)" name="paymentReference" placeholder="Renewal receipt or invoice" />
        </div>
        <div className="settings-submit"><span>IF CURRENT ACCESS HAS EXPIRED, EXTENSION STARTS FROM TODAY</span><button className="button button-dark" type="submit" disabled={busy}>Extend plan</button></div>
      </form>
      <form key={`integrations-${selected.id}`} className="settings-form" onSubmit={saveIntegrations}>
        <span className="eyebrow">LIVE ACTIVATION · CHANNEL SETUP</span>
        <div className="form-grid">
          <Field label="Meta WhatsApp Phone Number ID" name="whatsappPhoneNumberId" defaultValue={selected.integrations.whatsappPhoneNumberId} placeholder="Configured when activating WhatsApp" />
          <Field label="Twilio sender number" name="twilioPhoneNumber" defaultValue={selected.integrations.twilioPhoneNumber} placeholder="+15551234567" />
          <Field label="Verified outbound email" name="outboundEmail" type="email" defaultValue={selected.integrations.outboundEmail} placeholder="messages@yourdomain.com" />
        </div>
        <div className="settings-submit"><span>TRIAL DOES NOT USE THESE PROVIDERS</span><button className="button button-outline" type="submit" disabled={busy || (selected.mode === "LIVE" && selected.status === "ACTIVE")}>Save live setup</button></div>
      </form>
      <form key={`mode-${selected.id}`} className="settings-form" onSubmit={changeMode}>
        <span className="eyebrow">SECURITY-SENSITIVE MODE CHANGE</span>
        <div className="form-grid">
          <label className="field"><span>New mode</span><select name="mode" value={requestedMode} onChange={(event) => setRequestedMode(event.target.value as typeof requestedMode)}><option value="LIVE">LIVE</option><option value="TRIAL">TRIAL</option><option value="SUSPENDED">SUSPENDED</option></select></label>
          <Field label={`Type ${requiredConfirmation} to confirm`} name="confirmation" required />
        </div>
        <div className="settings-submit"><span>CHANGE WILL BE RECORDED IN THE AUDIT LOG</span><button className="button button-dark" type="submit" disabled={busy}>Apply mode</button></div>
      </form>
      <form key={`trial-${selected.id}`} className="settings-form" onSubmit={saveTrialSettings}>
        <span className="eyebrow">CONFIGURABLE TRIAL LIMITS</span>
        <div className="form-grid">
          <Field label="Trial duration (days)" name="trialDurationDays" type="number" defaultValue={settings.trialDurationDays} required />
          <Field label="WhatsApp demo messages" name="maxWhatsAppDemoMessages" type="number" defaultValue={settings.maxWhatsAppDemoMessages} required />
          <Field label="SMS demo messages" name="maxSmsDemoMessages" type="number" defaultValue={settings.maxSmsDemoMessages} required />
          <Field label="Email demo messages" name="maxEmailDemoMessages" type="number" defaultValue={settings.maxEmailDemoMessages} required />
          <Field label="Voice demo messages" name="maxVoiceDemoMessages" type="number" defaultValue={settings.maxVoiceDemoMessages} required />
          <Field label="Maximum users" name="maxUsers" type="number" defaultValue={settings.maxUsers} required />
        </div>
        <div className="form-grid">
          {DEFAULT_TRIAL_SETTINGS.enabledFeatures.map((feature) => <label className="check-field" key={feature}><input type="checkbox" name="enabledFeatures" value={feature} defaultChecked={settings.enabledFeatures.includes(feature)} /><span>{feature}</span></label>)}
        </div>
        <div className="settings-submit"><span>TRIAL ENDS {selected.trialEndsAt ? shortDate(selected.trialEndsAt) : "NOT SET"}</span><button className="button button-outline" type="submit" disabled={busy}>Save trial limits</button></div>
      </form>
    </>}
  </section>;
}

function ActionModal({ kind, contacts, onClose, onSubmit }: { kind: Exclude<ModalKind, null>; contacts: Contact[]; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  if (kind !== "lead") return <ActionModalCore kind={kind} onClose={onClose} onSubmit={onSubmit} />;

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="action-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-top"><span className="eyebrow">TECHIESEE / PIPELINE</span><button className="icon-button" onClick={onClose} aria-label="Close dialog">×</button></div><h2 id="modal-title">Add a new lead</h2><p>Attach an opportunity to someone already in your contacts.</p><form onSubmit={onSubmit} className="modal-form"><label className="field field-span"><span>Contact</span><select name="contactId" defaultValue="" required><option value="" disabled>Select a contact</option>{contacts.map((contact) => <option value={contact.id} key={contact.id}>{contact.name}{contact.company ? ` · ${contact.company}` : ""}</option>)}</select></label><Field label="Source" name="source" placeholder="WhatsApp, website, referral…" /><Field label="Potential value (INR)" name="value" type="number" placeholder="15000" /><div className="modal-actions"><button className="button button-quiet" type="button" onClick={onClose}>Cancel</button><button className="button button-dark" type="submit">Add to pipeline <span>↗</span></button></div></form></section></div>;
}

function ActionModalCore({ kind, onClose, onSubmit }: { kind: "contact" | "product" | "simulate"; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const titles = { contact: "Add a new person", product: "Add an offer", simulate: "Send a test message" };
  const subtitles = { contact: "A new relationship for your business.", product: "Give your assistant accurate details to quote.", simulate: "Watch the assistant handle a customer message end to end." };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="action-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-top"><span className="eyebrow">TECHIESEE / {kind === "simulate" ? "WHATSAPP LAB" : "WORKSPACE"}</span><button className="icon-button" onClick={onClose} aria-label="Close dialog">×</button></div><h2 id="modal-title">{titles[kind]}</h2><p>{subtitles[kind]}</p><form onSubmit={onSubmit} className="modal-form">{kind === "contact" && <><Field label="Full name" name="name" placeholder="Customer name" required /><Field label="Phone number" name="phone" placeholder="+91 98765 43210" /><Field label="Email address" name="email" type="email" placeholder="name@email.com" /><Field label="Company" name="company" placeholder="Company or studio" /></>}{kind === "product" && <><Field label="Offer name" name="name" placeholder="Personal training session" required /><Field label="Price (INR)" name="price" type="number" placeholder="2500" required /><Field label="Category" name="category" placeholder="Consultation, service…" /><Field label="Duration in minutes" name="durationMin" type="number" placeholder="60" /><label className="field field-span"><span>Description</span><textarea name="description" rows={3} placeholder="What is included?" /></label></>}{kind === "simulate" && <><Field label="Customer name" name="contactName" placeholder="Aarav Sharma" required /><Field label="WhatsApp number" name="contactPhone" placeholder="+91 98765 43210" required /><label className="field field-span"><span>Incoming message</span><textarea name="message" rows={4} defaultValue="Hi! Could you tell me about your services and pricing?" required /></label><div className="simulator-hint"><span>✳</span><p>This uses the same AI orchestrator as WhatsApp. Add an OpenAI key and business instructions for a live AI reply.</p></div></>}{<div className="modal-actions"><button className="button button-quiet" type="button" onClick={onClose}>Cancel</button><button className="button button-dark" type="submit">{kind === "simulate" ? "Send to assistant" : kind === "product" ? "Save offer" : "Add contact"}<span>↗</span></button></div>}</form></section></div>;
}

export default Home;