"use client";

import { FormEvent, useState } from "react";

export type Agent = { id: string; name: string; description?: string | null; instructions: string; isDefault: boolean; isActive: boolean };
export type AutomationAction =
  | { type: "SEND_MESSAGE"; channel: "WHATSAPP" | "SMS" | "EMAIL"; content: string; subject?: string }
  | { type: "SET_LEAD_STATUS"; status: "NEW" | "CONTACTED" | "QUALIFIED" | "PROPOSAL" | "NEGOTIATION" | "WON" | "LOST" };
export type AutomationCondition = { field: string; operator: "equals" | "contains"; value: string };
export type AutomationWorkflow = { id: string; name: string; description?: string | null; trigger: "LEAD_CREATED" | "MESSAGE_RECEIVED" | "APPOINTMENT_BOOKED"; isActive: boolean; conditions?: AutomationCondition[] | null; actions: AutomationAction[]; _count?: { runs: number } };
export type AutomationRun = { id: string; workflowId: string; status: "SUCCEEDED" | "FAILED"; trigger: string; error?: string | null; startedAt: string; workflow?: { id: string; name: string } };
export type ChannelAvailability = { whatsapp: boolean; sms: boolean; voice: boolean; email: boolean; demo?: boolean; mode?: "TRIAL" | "LIVE" };
export type WorkspaceContact = { id: string; name: string; phone?: string | null; email?: string | null };

function Status({ ready, demo }: { ready: boolean; demo?: boolean }) {
  return <span className={`integration-state ${ready ? "ready" : "not-ready"}`}><i />{ready ? demo ? "DEMO READY" : "CONNECTED" : "NEEDS SETUP"}</span>;
}

function WorkflowBuilder({ onCreate }: { onCreate: (workflow: Omit<AutomationWorkflow, "id" | "isActive" | "_count">) => Promise<void> }) {
  const [actionType, setActionType] = useState<"SEND_MESSAGE" | "SET_LEAD_STATUS">("SEND_MESSAGE");
  const [channel, setChannel] = useState<"WHATSAPP" | "SMS" | "EMAIL">("WHATSAPP");
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const conditions = values.conditionField && values.conditionValue
      ? [{ field: String(values.conditionField), operator: String(values.conditionOperator) as "equals" | "contains", value: String(values.conditionValue) }]
      : undefined;
    const actions: AutomationAction[] = actionType === "SEND_MESSAGE"
      ? [{ type: "SEND_MESSAGE", channel, content: String(values.content), subject: channel === "EMAIL" ? String(values.subject || "") : undefined }]
      : [{ type: "SET_LEAD_STATUS", status: String(values.status) as Extract<AutomationAction, { type: "SET_LEAD_STATUS" }>["status"] }];
    try {
      await onCreate({ name: String(values.name), description: String(values.description || "") || undefined, trigger: String(values.trigger) as AutomationWorkflow["trigger"], conditions, actions });
      form.reset();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Workflow could not be saved");
    }
  };

  return <form className="module-builder" onSubmit={submit}><div className="module-builder-heading"><div><span className="eyebrow">EVENT → ACTION</span><h3>Build a workflow</h3></div><span className="module-symbol">↯</span></div><div className="module-form-grid"><label className="field"><span>Workflow name</span><input name="name" placeholder="Welcome new leads" required /></label><label className="field"><span>Trigger event</span><select name="trigger"><option value="LEAD_CREATED">Lead created</option><option value="MESSAGE_RECEIVED">Customer message received</option><option value="APPOINTMENT_BOOKED">Appointment booked</option></select></label><label className="field"><span>Optional condition field</span><input name="conditionField" placeholder="lead.source or message.channel" /></label><label className="field"><span>Condition</span><div className="condition-controls"><select name="conditionOperator"><option value="equals">equals</option><option value="contains">contains</option></select><input name="conditionValue" placeholder="whatsapp" /></div></label><label className="field"><span>Then do</span><select value={actionType} onChange={(event) => setActionType(event.target.value as typeof actionType)}><option value="SEND_MESSAGE">Send a customer message</option><option value="SET_LEAD_STATUS">Update a lead stage</option></select></label>{actionType === "SEND_MESSAGE" ? <><label className="field"><span>Channel</span><select value={channel} onChange={(event) => setChannel(event.target.value as typeof channel)}><option value="WHATSAPP">WhatsApp</option><option value="SMS">SMS</option><option value="EMAIL">Email</option></select></label>{channel === "EMAIL" && <label className="field field-span"><span>Email subject</span><input name="subject" placeholder="A note from our team" /></label>}<label className="field field-span"><span>Message</span><textarea name="content" rows={3} placeholder="Hi {{contact.name}}, thanks for reaching out…" required /></label></> : <label className="field"><span>New lead stage</span><select name="status"><option value="CONTACTED">Contacted</option><option value="QUALIFIED">Qualified</option><option value="PROPOSAL">Proposal</option><option value="NEGOTIATION">Negotiation</option><option value="WON">Won</option><option value="LOST">Lost</option></select></label>}<label className="field field-span"><span>Purpose (optional)</span><input name="description" placeholder="A short note for your team" /></label></div>{error && <p className="form-error">{error}</p>}<button className="button button-acid" type="submit">Create workflow <span>↗</span></button></form>;
}

export function AgentsPanel({ agents, onCreate, onUpdate, onDelete }: { agents: Agent[]; onCreate: (agent: Omit<Agent, "id" | "isActive">) => Promise<void>; onUpdate: (id: string, changes: Partial<Agent>) => void; onDelete: (agent: Agent) => void }) {
  const [editing, setEditing] = useState("");
  const [error, setError] = useState("");
  const saveAgent = async (event: FormEvent<HTMLFormElement>, id?: string) => {
    event.preventDefault();
    setError("");
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const data = { name: String(values.name), description: String(values.description || "") || undefined, instructions: String(values.instructions), isDefault: values.isDefault === "on", isActive: values.isActive !== "off" };
    try {
      if (id) { await onUpdate(id, data); setEditing(""); }
      else await onCreate(data);
      if (!id) form.reset();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Agent could not be saved");
    }
  };

  return <div className="agents-layout"><section className="module-builder"><div className="module-builder-heading"><div><span className="eyebrow">ROLE + GUARDRAILS</span><h3>Create an AI agent</h3></div><span className="module-symbol">✳</span></div><form className="module-form-grid" onSubmit={(event) => void saveAgent(event)}><label className="field"><span>Agent name</span><input name="name" placeholder="Customer care" required /></label><label className="field"><span>Description</span><input name="description" placeholder="Handles new enquiries" /></label><label className="field field-span"><span>Instructions</span><textarea name="instructions" rows={5} placeholder="Role, tone, escalation rules, and what this agent should never do…" required /></label><label className="check-field"><input name="isDefault" type="checkbox" /><span>Make the default agent for new conversations</span></label>{error && <p className="form-error field-span">{error}</p>}<button className="button button-acid" type="submit">Add AI agent <span>↗</span></button></form></section><section className="agent-list"><div className="module-section-heading"><div><span className="eyebrow">WORKSPACE AGENTS</span><h3>{agents.length} configured</h3></div></div>{agents.length === 0 ? <div className="panel"><div className="empty-state"><span className="empty-spark">✳</span><strong>Your first agent starts here</strong><p>Set an agent’s role and instructions. New conversations will use the default agent.</p></div></div> : agents.map((agent, index) => <article className="agent-card" key={agent.id}><div className="agent-card-head"><span className={`agent-avatar agent-tone-${index % 3}`}>A{String(index + 1).padStart(2, "0")}</span><div className="agent-card-title"><strong>{agent.name}</strong><span>{agent.description || "AI customer conversation agent"}</span></div>{agent.isDefault && <span className="default-label">DEFAULT</span>}<Status ready={agent.isActive} /></div>{editing === agent.id ? <form className="agent-edit-form" onSubmit={(event) => void saveAgent(event, agent.id)}><label className="field"><span>Name</span><input name="name" defaultValue={agent.name} required /></label><label className="field"><span>Description</span><input name="description" defaultValue={agent.description ?? ""} /></label><label className="field field-span"><span>Instructions</span><textarea name="instructions" rows={5} defaultValue={agent.instructions} required /></label><label className="check-field"><input name="isDefault" type="checkbox" defaultChecked={agent.isDefault} /><span>Default agent</span></label><div className="agent-edit-actions"><button className="button button-quiet" type="button" onClick={() => setEditing("")}>Cancel</button><button className="button button-dark" type="submit">Save agent</button></div></form> : <><p className="agent-instructions">{agent.instructions}</p><div className="agent-card-actions"><button className="text-button" onClick={() => setEditing(agent.id)}>Edit instructions</button>{!agent.isDefault && <button className="text-button" onClick={() => onUpdate(agent.id, { isDefault: true })}>Set as default</button>}<button className="text-button" onClick={() => onUpdate(agent.id, { isActive: !agent.isActive })}>{agent.isActive ? "Pause agent" : "Activate"}</button><button className="text-button danger-text" onClick={() => onDelete(agent)}>Delete</button></div></>}</article>)}</section></div>;
}

export function AutomationsPanel({ workflows, runs, onCreate, onUpdate, onDelete }: { workflows: AutomationWorkflow[]; runs: AutomationRun[]; onCreate: (workflow: Omit<AutomationWorkflow, "id" | "isActive" | "_count">) => Promise<void>; onUpdate: (id: string, changes: Partial<AutomationWorkflow>) => void; onDelete: (workflow: AutomationWorkflow) => void }) {
  const labels: Record<AutomationWorkflow["trigger"], string> = { LEAD_CREATED: "Lead created", MESSAGE_RECEIVED: "Message received", APPOINTMENT_BOOKED: "Appointment booked" };
  return <div className="automation-layout"><WorkflowBuilder onCreate={onCreate} /><section className="workflow-list"><div className="module-section-heading"><div><span className="eyebrow">AUTOMATION ENGINE</span><h3>{workflows.length} workflows <span>·</span> {workflows.filter((workflow) => workflow.isActive).length} active</h3></div></div>{workflows.length === 0 ? <div className="panel"><div className="empty-state"><span className="empty-spark">↯</span><strong>Nothing is on autopilot yet</strong><p>Create a workflow to send messages or update a lead when a business event happens.</p></div></div> : workflows.map((workflow) => <article className="workflow-card" key={workflow.id}><div className="workflow-card-top"><span className={`workflow-state ${workflow.isActive ? "" : "paused"}`}><i />{workflow.isActive ? "ACTIVE" : "PAUSED"}</span><span className="workflow-trigger">WHEN · {labels[workflow.trigger]}</span><span className="workflow-run-count">{workflow._count?.runs ?? 0} RUNS</span></div><h4>{workflow.name}</h4>{workflow.description && <p>{workflow.description}</p>}<div className="workflow-action-summary">{workflow.actions.map((action, index) => <span key={`${action.type}-${index}`}>{action.type === "SEND_MESSAGE" ? `${action.channel} message` : `Set lead ${action.status.toLowerCase()}`}</span>)}</div>{workflow.conditions?.map((condition, index) => <small className="workflow-condition" key={`${condition.field}-${index}`}>IF {condition.field} {condition.operator} “{condition.value}”</small>)}<div className="workflow-card-actions"><button className="text-button" onClick={() => onUpdate(workflow.id, { isActive: !workflow.isActive })}>{workflow.isActive ? "Pause" : "Activate"} workflow</button><button className="text-button danger-text" onClick={() => onDelete(workflow)}>Delete</button></div></article>)}</section><section className="runs-panel"><div className="module-section-heading"><div><span className="eyebrow">EXECUTION LOG</span><h3>Recent runs</h3></div></div>{runs.length === 0 ? <p className="run-empty">Runs appear here after a matching event fires.</p> : runs.slice(0, 8).map((run) => <div className="run-row" key={run.id}><span className={`run-outcome ${run.status.toLowerCase()}`}><i />{run.status}</span><strong>{run.workflow?.name ?? run.trigger}</strong><time>{new Date(run.startedAt).toLocaleString()}</time>{run.error && <small>{run.error}</small>}</div>)}</section></div>;
}

export function ChannelsPanel({ contacts, agents, availability, onSend, onCall }: { contacts: WorkspaceContact[]; agents: Agent[]; availability: ChannelAvailability | null; onSend: (message: { contactId: string; channel: "WHATSAPP" | "SMS" | "EMAIL"; content: string; subject?: string }) => Promise<void>; onCall: (call: { contactId: string; agentId?: string }) => Promise<void> }) {
  const [channel, setChannel] = useState<"WHATSAPP" | "SMS" | "EMAIL">("WHATSAPP");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const status = availability ?? { whatsapp: false, sms: false, voice: false, email: false, demo: false };
  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      await onSend({ contactId: String(values.contactId), channel, content: String(values.content), subject: String(values.subject || "") || undefined });
      form.reset();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Message was not accepted by the provider");
    } finally {
      setBusy(false);
    }
  };
  const call = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      await onCall({ contactId: String(values.contactId), agentId: String(values.agentId || "") || undefined });
      form.reset();
    } catch (callError) {
      setError(callError instanceof Error ? callError.message : "Call could not be started");
    } finally {
      setBusy(false);
    }
  };

  return <div className="channels-layout">{status.demo && <div className="partial-notice">Trial mode is active: every channel below runs a local demo and cannot contact real customers.</div>}<section className="channel-status-grid"><ChannelStatusCard name="WHATSAPP" detail={status.demo ? "Demo simulation" : "Meta Cloud API"} ready={status.whatsapp} demo={status.demo} /><ChannelStatusCard name="SMS" detail={status.demo ? "Demo simulation" : "Twilio Messaging"} ready={status.sms} demo={status.demo} /><ChannelStatusCard name="AI TELECALLING" detail={status.demo ? "Browser/demo voice" : "Twilio Voice + speech agent"} ready={status.voice} demo={status.demo} /><ChannelStatusCard name="EMAIL" detail={status.demo ? "Demo simulation" : "Resend transactional email"} ready={status.email} demo={status.demo} /></section><section className="channel-workspace"><form className="module-builder" onSubmit={send}><div className="module-builder-heading"><div><span className="eyebrow">OUTBOUND COMMUNICATION</span><h3>{status.demo ? "Simulate a customer message" : "Send a customer message"}</h3></div><span className="module-symbol">↗</span></div><div className="module-form-grid"><label className="field"><span>Customer</span><select name="contactId" defaultValue="" required><option value="" disabled>Select a contact</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name} · {contact.email || contact.phone || "No channel details"}</option>)}</select></label><label className="field"><span>Channel</span><select value={channel} onChange={(event) => setChannel(event.target.value as typeof channel)}><option value="WHATSAPP">WhatsApp</option><option value="SMS">SMS</option><option value="EMAIL">Email</option></select></label>{channel === "EMAIL" && <label className="field field-span"><span>Subject</span><input name="subject" placeholder="A message from our team" /></label>}<label className="field field-span"><span>Message</span><textarea name="content" rows={5} placeholder="Write a clear message…" required /></label></div>{error && <p className="form-error">{error}</p>}<button className="button button-dark" type="submit" disabled={busy || contacts.length === 0}>{busy ? "Sending…" : status.demo ? "Run demo and track result" : "Send and track delivery"}<span>↗</span></button></form><form className="module-builder call-builder" onSubmit={call}><div className="module-builder-heading"><div><span className="eyebrow">AI TELECALLING</span><h3>{status.demo ? "Simulate a voice call" : "Start a voice conversation"}</h3></div><span className="module-symbol">◉</span></div><p className="module-explainer">{status.demo ? "Trial calls are recorded as demos only. They never dial a phone number." : "Twilio starts the call; the selected agent listens and replies over speech. Call state and transcript are attached to the CRM conversation."}</p><div className="module-form-grid"><label className="field"><span>Customer</span><select name="contactId" defaultValue="" required><option value="" disabled>Select a contact</option>{contacts.filter((contact) => contact.phone).map((contact) => <option key={contact.id} value={contact.id}>{contact.name} · {contact.phone}</option>)}</select></label><label className="field"><span>AI agent</span><select name="agentId" defaultValue=""><option value="">Default agent</option>{agents.filter((agent) => agent.isActive).map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label></div><button className="button button-acid" type="submit" disabled={busy || !status.voice || contacts.every((contact) => !contact.phone)}>{busy ? "Connecting…" : status.demo ? "Run voice demo" : "Call with AI agent"}<span>↗</span></button>{!status.voice && <p className="provider-requirement">Voice needs Twilio credentials, a linked phone number, and a publicly reachable API URL in backend environment settings.</p>}</form></section><p className="provider-privacy">Provider API keys stay on the backend. Message attempts are saved in the CRM with provider IDs and delivery states.</p></div>;
}

function ChannelStatusCard({ name, detail, ready, demo }: { name: string; detail: string; ready: boolean; demo?: boolean }) {
  return <article className="channel-status-card"><span className="eyebrow">{name}</span><strong>{detail}</strong><Status ready={ready} demo={demo} /></article>;
}