"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import styles from "./workshop.module.css";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api").replace(/\/$/, "");

const plans = [
  { id: "monthly", duration: "1 month", price: 99, note: "A simple way to get started" },
  { id: "halfYear", duration: "6 months", price: 199, note: "More time to build your rhythm", featured: true },
  { id: "sevenMonths", duration: "7 months", price: 299, note: "Keep your business moving" },
] as const;

type PlanId = (typeof plans)[number]["id"];

const features = [
  { icon: "↗", title: "A clearer lead pipeline", body: "See new enquiries, follow-ups, and opportunities together instead of losing track across chats." },
  { icon: "◎", title: "Customer conversations", body: "Bring conversations into one workspace and keep a human in control when a customer needs you." },
  { icon: "◷", title: "Appointments & contacts", body: "Organize your customer details, bookings, and next steps in one simple place." },
  { icon: "✳", title: "AI agents & automations", body: "Set up AI assistance and business workflows to take repetitive work off your plate." },
];

const faqs = [
  {
    question: "How do I get access to the business workshop?",
    answer: "Choose a plan and send an access request. We’ll contact you to arrange payment and manually activate your business workspace.",
  },
  {
    question: "Does the plan request take payment online?",
    answer: "No. This website sends an access request only. Payment is arranged directly after we contact you.",
  },
  {
    question: "What can I manage in the business workspace?",
    answer: "Bring together business leads, customer conversations, contacts, appointments, AI agents, and automations in one workspace.",
  },
];

export default function SalesLanding() {
  const siteRef = useRef<HTMLElement>(null);
  const [motionReady, setMotionReady] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<PlanId>("halfYear");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;

    const root = siteRef.current;
    if (!root) return;
    const elements = root.querySelectorAll<HTMLElement>("[data-reveal]");
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add(styles.isVisible);
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.12, rootMargin: "0px 0px -36px 0px" });

    elements.forEach((element) => observer.observe(element));
    setMotionReady(true);

    return () => observer.disconnect();
  }, []);

  function choosePlan(plan: PlanId) {
    setSelectedPlan(plan);
    setMessage("");
    document.getElementById("request-access")?.scrollIntoView({ behavior: "smooth" });
  }

  function updatePlan(value: string) {
    const plan = plans.find((item) => item.id === value);
    if (plan) setSelectedPlan(plan.id);
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setSubmitting(true);
    setMessage("");

    const form = new FormData(formElement);
    const request = {
      name: String(form.get("name") ?? ""),
      businessName: String(form.get("businessName") ?? ""),
      email: String(form.get("email") ?? ""),
      phone: String(form.get("phone") ?? ""),
      plan: selectedPlan,
    };

    try {
      const response = await fetch(`${API_BASE}/sales/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const payload = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "We could not send your request. Please try again.");
      setIsError(false);
      setMessage(payload.message ?? "Request received. We’ll be in touch soon.");
      formElement.reset();
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "We could not send your request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main ref={siteRef} className={`${styles.site} ${motionReady ? styles.motionReady : ""}`}>
      <header className={styles.nav}>
        <a className={styles.brand} href="#" aria-label="Rohit AI Studio home">
          <span className={styles.brandMark}><i /><i /><i /><i /></span>
          <span>ROHIT AI <b>STUDIO</b></span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#features">What you get</a>
          <a href="#plans">Plans</a>
        </nav>
        <a className={styles.navCta} href="#plans">Explore plans <span>↗</span></a>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroCopy} data-reveal>
          <div className={styles.eyebrow}><span /> YOUR BUSINESS, IN MOTION</div>
          <h1>Run your business.<br /><em>Not after it.</em></h1>
          <p className={styles.heroIntro}>One calm workspace for your leads, conversations, appointments, and AI-powered customer care.</p>
          <div className={styles.heroActions}>
            <a className={styles.primaryButton} href="#plans">Find your plan <span>↗</span></a>
            <a className={styles.textLink} href="#features">See what’s inside <span>↓</span></a>
          </div>
          <div className={styles.heroNote}><span className={styles.noteIcon}>✓</span><span><strong>People stay in control.</strong> AI helps with the busywork.</span></div>
        </div>

        <div className={styles.preview} data-reveal role="img" aria-label="Illustrated business dashboard showing leads, conversations, appointments, and an AI assistant">
          <div className={styles.previewTop}><span><i /> LIVE WORKSPACE</span><span>MONDAY, 9:41 AM</span></div>
          <div className={styles.previewHeading}><div><small>GOOD MORNING</small><h2>Your business, at a glance.</h2></div><span className={styles.avatar}>R</span></div>
          <div className={styles.previewMetrics}>
            <div><small>ACTIVE LEADS</small><strong>24 <i>↗</i></strong><span>4 new this week</span></div>
            <div><small>CONVERSATIONS</small><strong>08 <i>◎</i></strong><span>All in one place</span></div>
            <div><small>UPCOMING</small><strong>12 <i>◷</i></strong><span>Appointments</span></div>
          </div>
          <div className={styles.previewBottom}>
            <div className={styles.pipeline}>
              <div className={styles.previewSectionTitle}><span>LEAD PIPELINE</span><span>THIS MONTH ↗</span></div>
              <div className={styles.pipelineBars}><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
              <div className={styles.pipelineLabels}><span>WEEK 01</span><span>WEEK 02</span><span>WEEK 03</span><span>WEEK 04</span></div>
            </div>
            <div className={styles.aiCard}><span className={styles.aiSpark}>✳</span><div><small>YOUR AI ASSISTANT</small><strong>Ready when you are.</strong><span>Keep the human in the loop.</span></div><b>↗</b></div>
          </div>
          <div className={styles.previewFoot}><span>✳ MADE FOR THE WAY YOU WORK</span><span>01 / OVERVIEW</span></div>
        </div>
        <div className={styles.floatingTag} aria-hidden="true"><span>✳</span><div>BUILT FOR<br /><strong>REAL BUSINESS</strong></div></div>
        <div className={styles.heroFoot}><span>BUILT FOR THE PEOPLE BEHIND THE BUSINESS</span><span>01 — 04 / YOUR WORKSPACE</span></div>
      </section>

      <section className={styles.featuresSection} id="features">
        <div className={styles.sectionIntro} data-reveal>
          <div><div className={styles.eyebrow}>THE IMPORTANT THINGS, TOGETHER</div><h2>Less scattered.<br /><em>More in sync.</em></h2></div>
          <p>Everything your business needs to keep customer relationships moving—without adding another complicated process to your day.</p>
        </div>
        <div className={styles.featureGrid}>
          {features.map((feature, index) => (
            <article className={styles.featureCard} data-reveal key={feature.title}>
              <div className={styles.featureTop}><span className={styles.featureIcon}>{feature.icon}</span><span>0{index + 1}</span></div>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
              <span className={styles.featureArrow}>↗</span>
            </article>
          ))}
        </div>
        <div className={styles.humanNote} data-reveal><span>✳</span><p><strong>AI that works with you.</strong> Keep your customer relationships personal, with the tools to make the everyday work feel lighter.</p></div>
      </section>

      <section className={styles.plansSection} id="plans">
        <div className={styles.plansIntro} data-reveal>
          <div className={styles.eyebrow}>A PLAN THAT FITS YOUR NEXT CHAPTER</div>
          <h2>Start where <em>you are.</em></h2>
          <p>Choose a plan to request workshop access. We’ll get in touch to arrange payment and activate your business workspace.</p>
        </div>
        <div className={styles.planGrid}>
          {plans.map((plan) => (
            <article className={`${styles.planCard} ${"featured" in plan && plan.featured ? styles.featuredPlan : ""}`} data-reveal key={plan.id}>
              {"featured" in plan && plan.featured && <div className={styles.popularTag}>A LITTLE MORE ROOM</div>}
              <div className={styles.planDuration}>{plan.duration} access</div>
              <div className={styles.planPrice}><span>₹</span>{plan.price}<small> / plan</small></div>
              <p>{plan.note}</p>
              <ul>
                <li><span>✓</span> Your own business workspace</li>
                <li><span>✓</span> Leads, contacts & conversations</li>
                <li><span>✓</span> Appointments & AI tools</li>
                <li><span>✓</span> Personal access setup</li>
              </ul>
              <button className={styles.planButton} onClick={() => choosePlan(plan.id)}>Request this plan <span>↗</span></button>
            </article>
          ))}
        </div>
        <p className={styles.planFineprint}>No online payment is collected on this page. We’ll confirm your request and help you with the next steps.</p>
      </section>

      <section className={styles.requestSection} id="request-access">
        <div className={styles.requestCopy} data-reveal>
          <div className={styles.eyebrow}>YOUR NEXT MOVE</div>
          <h2>Let’s get your<br /><em>workspace ready.</em></h2>
          <p>Tell us a little about your business. We’ll follow up about your selected plan and help you get set up.</p>
          <div className={styles.requestPromise}><span>01</span><p><strong>You send your request</strong><br />Pick a plan and share your details.</p></div>
          <div className={styles.requestPromise}><span>02</span><p><strong>We get in touch</strong><br />We’ll help arrange payment and access.</p></div>
        </div>
        <form className={styles.requestForm} data-reveal onSubmit={submitRequest}>
          <div className={styles.formHeading}><span>ACCESS REQUEST</span><span>✳ PRIVATE & PERSONAL</span></div>
          <label>Your name<input name="name" autoComplete="name" placeholder="e.g. Aanya Sharma" required maxLength={100} /></label>
          <label>Business name<input name="businessName" autoComplete="organization" placeholder="What’s your business called?" required maxLength={120} /></label>
          <div className={styles.formRow}>
            <label>Email address<input name="email" type="email" autoComplete="email" placeholder="you@example.com" required maxLength={254} /></label>
            <label>Phone <span>(optional)</span><input name="phone" type="tel" autoComplete="tel" placeholder="+91 ..." maxLength={30} /></label>
          </div>
          <label>Selected plan
            <select value={selectedPlan} onChange={(event) => updatePlan(event.target.value)}>
              {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.duration} — ₹{plan.price}</option>)}
            </select>
          </label>
          <button className={styles.submitButton} type="submit" disabled={submitting}>{submitting ? "Sending your request…" : "Request workshop access"} <span>↗</span></button>
          {message && <p className={`${styles.formMessage} ${isError ? styles.formError : styles.formSuccess}`} role="status">{message}</p>}
          <p className={styles.formPrivacy}>By sending this request, you’re asking us to contact you about your selected plan. No payment is taken here.</p>
        </form>
      </section>

      <section className={styles.faqSection} aria-labelledby="faq-heading">
        <div className={styles.faqIntro} data-reveal>
          <div className={styles.eyebrow}>GOOD TO KNOW</div>
          <h2 id="faq-heading">A few things,<br /><em>made clear.</em></h2>
        </div>
        <div className={styles.faqList}>
          {faqs.map((faq, index) => (
            <details className={styles.faqItem} data-reveal key={faq.question}>
              <summary><span>{faq.question}</span><i aria-hidden="true">{index + 1}</i></summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className={styles.footer}>
        <a className={styles.brand} href="#"><span className={styles.brandMark}><i /><i /><i /><i /></span><span>ROHIT AI <b>STUDIO</b></span></a>
        <span>BUILT TO KEEP THE HUMAN IN THE LOOP.</span>
        <a href="#plans">Explore plans ↑</a>
      </footer>
    </main>
  );
}
