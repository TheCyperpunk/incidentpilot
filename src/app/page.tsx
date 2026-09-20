"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Activity = { title: string; detail: string; time: string; kind?: "alert" | "deploy" | "signal" | "agent" | "success" };
type RootCause = { file: string; function: string; summary: string; evidence: string[]; confidence: string; tests: { command: string; exitCode: number; summary: string }[]; provider: string };
type Triage = { summary: string; provider: "openai" | "simulation" };
type ActiveRepository = { full_name: string; default_branch: string } | null;
type InvestigationPayload = { id: string; status: string; pinnedCommitSha?: string; triage?: Triage; rootCause?: RootCause; events: { message: string; detail: string; type: string }[] };

const initialActivity: Activity[] = [
  { title: "Checkout health threshold breached", detail: "5xx responses crossed the critical alert threshold.", time: "14:03", kind: "alert" },
  { title: "Deployment correlated", detail: "Version v2.8.1 reached production two minutes before impact.", time: "14:01", kind: "deploy" },
  { title: "Baseline identified", detail: "The previous healthy release was v2.8.0.", time: "13:58", kind: "signal" },
];

function Metric({ label, value, detail, alert, chart }: { label: string; value: string; detail: string; alert?: boolean; chart: number[] }) {
  return <section className={`metric ${alert ? "metric-alert" : ""}`}><div><span>{label}</span><small>{detail}</small></div><strong>{value}</strong><div className="spark">{chart.map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div></section>;
}

function Icon({ kind = "signal" }: { kind?: Activity["kind"] }) {
  const path = kind === "alert" ? <path d="M12 3 2.8 19h18.4L12 3Zm0 5v4.8m0 3.2v.1" /> : kind === "success" ? <path d="m5 12 4.2 4.2L19.5 6" /> : kind === "deploy" ? <><path d="M6 5h12v4H6zM9 9v10m6-10v10M5 19h14" /><path d="M4 3h16" /></> : kind === "agent" ? <><rect x="4" y="5" width="16" height="14" rx="3" /><path d="M8 12h.01M16 12h.01M8 16c2.1 1 5.9 1 8 0" /></> : <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.7 1.7" /></>;
  return <span className={`event-icon ${kind}`}><svg viewBox="0 0 24 24">{path}</svg></span>;
}

export default function Home() {
  const [started, setStarted] = useState(false);
  const [activity, setActivity] = useState(initialActivity);
  const [runId, setRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState("standing by");
  const [error, setError] = useState<string | null>(null);
  const [triage, setTriage] = useState<Triage | null>(null);
  const [rootCauseState, setRootCause] = useState<RootCause | null>(null);
  const [activeRepository, setActiveRepository] = useState<ActiveRepository>(null);
  const [pinnedCommitSha, setPinnedCommitSha] = useState<string | null>(null);
  const rootCause = rootCauseState && {
    ...rootCauseState,
    tests: rootCauseState.tests.length ? rootCauseState.tests : [{ command: "No test was run or reported", exitCode: -1, summary: "Repository inspection completed without test output." }],
  };

  useEffect(() => {
    void fetch("/api/github/repositories").then(async (response) => {
      if (!response.ok) return;
      const body = await response.json() as { repository: ActiveRepository };
      setActiveRepository(body.repository);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const restoreLatestRun = async () => {
      const response = await fetch("/api/incidents/INC-2048/latest", { cache: "no-store" });
      if (response.status === 401 || response.status === 404) return;
      const run = await response.json() as InvestigationPayload & { error?: string };
      if (!response.ok) throw new Error(run.error ?? "Unable to restore investigation status");
      setRunId(run.id);
      setStarted(run.status !== "failed" && run.status !== "resolved");
      setRunStatus(run.status.replaceAll("_", " "));
      setPinnedCommitSha(run.pinnedCommitSha ?? null);
      if (run.triage) setTriage(run.triage);
      if (run.rootCause) setRootCause(run.rootCause);
      setActivity([...run.events.map((event): Activity => ({ title: event.message, detail: event.detail, time: "saved", kind: event.type === "resolved" ? "success" : "agent" })), ...initialActivity]);
    };
    void restoreLatestRun().catch((cause: Error) => setError(cause.message));
  }, []);

  useEffect(() => {
    if (!runId) return;
    const refresh = async () => {
      const response = await fetch(`/api/investigation-runs/${runId}`);
      const run = await response.json() as InvestigationPayload & { error?: string };
      if (!response.ok) throw new Error(run.error ?? "Unable to refresh investigation status");
      setRunStatus(run.status.replaceAll("_", " "));
      setPinnedCommitSha(run.pinnedCommitSha ?? null);
      if (run.triage) setTriage(run.triage);
      if (run.rootCause) setRootCause(run.rootCause);
      setActivity([...run.events.map((event): Activity => ({ title: event.message, detail: event.detail, time: "now", kind: event.type === "resolved" ? "success" : "agent" })), ...initialActivity]);
    };
    void refresh().catch((cause: Error) => setError(cause.message));
    const timer = window.setInterval(() => void refresh().catch((cause: Error) => setError(cause.message)), 900);
    return () => window.clearInterval(timer);
  }, [runId]);

  async function investigate() {
    if (started) return;
    setStarted(true); setError(null);
    try {
      const response = await fetch("/api/incidents/INC-2048/investigate", { method: "POST" });
      const run = await response.json() as InvestigationPayload & { error?: string };
      if (!response.ok) throw new Error(run.error ?? "Unable to start investigation");
      setRunId(run.id); setPinnedCommitSha(run.pinnedCommitSha ?? null); if (run.triage) setTriage(run.triage);
    } catch (cause) { setStarted(false); setError(cause instanceof Error ? cause.message : "Unable to start investigation"); }
  }

  async function approve() {
    if (!runId) return;
    const response = await fetch(`/api/investigation-runs/${runId}/approve`, { method: "POST" });
    const run = await response.json();
    if (!response.ok) { setError(run.error ?? "Unable to approve mitigation"); return; }
    setRunStatus(run.status.replaceAll("_", " "));
  }

  const resolved = runStatus === "resolved";
  const liveRepositoryEvidence = rootCause?.provider === "codex";
  return <main className="app-shell">
    <nav className="topbar"><Link className="brand" href="/"><b>i</b> incident<span>pilot</span></Link><i className="divider" /><span className="workspace-dot" /> <span className="workspace-name">Production command center</span><div className="top-actions"><span className="sim-label"><i /> {liveRepositoryEvidence ? "GitHub App evidence" : "Controlled simulation"}</span><Link href="/settings/github">Repositories</Link><Link href="/login">Sign in <b>-&gt;</b></Link></div></nav>
    <div className="dashboard">
      <header className="hero"><div className="crumb">INCIDENTS <b>/</b> ACTIVE <b>/</b> <strong>INC-2048</strong></div><div className="hero-row"><div><div className="badges"><span className="severity">SEV 2</span><span className="live"><i /> Live incident</span></div><h1>Checkout API <em>degradation</em></h1><p>Checkout requests started failing shortly after the v2.8.1 production release.</p></div><div className="state"><span>INCIDENT STATE</span><strong className={resolved ? "resolved" : ""}><i /> {resolved ? "Resolved" : started ? runStatus : "Ready to investigate"}</strong><small>Started today at 14:03</small></div></div></header>
      <section className="metrics"><Metric label="Error rate" value={resolved ? "0.4%" : "18.4%"} detail={resolved ? "Recovered" : "+18.1 pts"} alert={!resolved} chart={resolved ? [20,25,21,18,17,15,13,12] : [14,16,20,25,31,46,73,96]} /><Metric label="P95 latency" value={resolved ? "180ms" : "850ms"} detail={resolved ? "Baseline" : "+670ms"} alert={!resolved} chart={resolved ? [31,35,27,30,24,25,26,23] : [17,19,23,31,44,58,82,94]} /><Metric label="Database CPU" value={resolved ? "41%" : "94%"} detail={resolved ? "Normal" : "+53%"} alert={!resolved} chart={resolved ? [34,39,35,42,38,43,39,41] : [28,31,37,43,56,67,83,97]} /><Metric label="Current release" value={resolved ? "v2.8.0" : "v2.8.1"} detail={resolved ? "Rolled back" : "14:01 deploy"} chart={[20,20,20,20,20,20,20,20]} /></section>
      <section className="workspace"><div className="primary">
        <section className="panel action-panel"><div className="panel-head"><div><p>INVESTIGATION</p><h2>Decide with evidence, not instinct.</h2></div><span className={`run-state ${started ? "active" : ""}`}><i /> {started ? "Runner active" : "Ready to investigate"}</span></div><div className="action-content"><div><p>Signals point to a database query regression, but a rollback needs repository evidence and a human decision.</p><div className="signals"><span>Release +2m before impact</span><span>Database timeout in logs</span><span>5xx above threshold</span></div></div><button onClick={investigate} disabled={started}><span>{started ? "Investigation in progress" : "Start investigation"}<small>{started ? "Gathering evidence" : "Pin commit and inspect evidence"}</small></span><b>-&gt;</b></button></div>{error && <div className="request-error">{error} {!started && error.includes("Sign in") && <a href="/login">Sign in to continue</a>}</div>}<footer><span>Verified commit</span><span>Test output captured</span><span>Approval required</span></footer></section>
        <section className="panel timeline-panel"><div className="panel-head"><div><p>INCIDENT TIMELINE</p><h2>Evidence trail</h2></div><span className="count">{activity.length} events</span></div><ol>{activity.map((item, index) => <li key={`${item.title}-${index}`}><Icon kind={item.kind} /><div><h3>{item.title}</h3><p>{item.detail}</p></div><time>{item.time}</time></li>)}</ol></section>
        {triage && <section className="panel triage"><b>AI</b><div><p>TRIAGE HYPOTHESIS</p><h2>Investigation priority established</h2><span>{triage.summary}</span><small>{triage.provider === "openai" ? "Generated by OpenAI. Hypothesis only; repository evidence and tests are still required." : "Controlled simulation fallback. Repository evidence and tests are still required."}</small></div></section>}
        {rootCause && <section className="panel root-cause"><div className="panel-head"><div><p>ROOT-CAUSE HYPOTHESIS</p><h2>Database query regression</h2></div><span className="confidence">{rootCause.confidence} confidence</span></div><p className="root-summary">{rootCause.summary}</p><div className="code"><div><span>FILE</span><strong>{rootCause.file}</strong></div><div><span>FUNCTION</span><strong>{rootCause.function}()</strong></div></div><ul>{rootCause.evidence.map((item) => <li key={item}><b>+</b>{item}</li>)}</ul><div className="test"><div><span>REGRESSION TEST</span><code>{rootCause.tests[0].command}</code></div><b>{rootCause.tests[0].exitCode === -1 ? "Not run" : `Exit ${rootCause.tests[0].exitCode}`}</b></div><small className="source">Source: {rootCause.provider === "simulation" ? "controlled simulation" : "isolated Codex runner"}</small>{!resolved && <button className="approve" onClick={approve} disabled={runStatus !== "awaiting approval"}>{runStatus === "awaiting approval" ? "Approve simulated rollback" : "Waiting for evidence verification"}<b>-&gt;</b></button>}{resolved && <div className="recovery"><b>✓</b><span><strong>Recovery verified</strong>All monitored thresholds are back within the healthy range.</span><a href="/incidents/INC-2048/postmortem">Read postmortem -&gt;</a></div>}</section>}
      </div><aside>
        <section className="panel deployment"><div className="panel-head"><div><p>DEPLOYMENT CONTEXT</p><h2>Version v2.8.1</h2></div><span>Production</span></div><div className="deploy-rail"><i /><i /><i /></div><dl><div><dt>Repository</dt><dd>{activeRepository?.full_name ?? "Not selected"} <small>{activeRepository ? "GitHub App" : "Repositories"}</small></dd></div><div><dt>Branch</dt><dd className="mono">{activeRepository?.default_branch ?? "—"}</dd></div><div><dt>Pinned commit</dt><dd className="mono">{pinnedCommitSha ?? "—"}</dd></div><div><dt>Last known healthy</dt><dd>v2.8.0 <small>13:58</small></dd></div></dl></section>
        <section className="panel runner"><div className="runner-mark"><i /><b /></div><p>CODEX RUNNER</p><h2>{started ? runStatus : "Standing by"}</h2><span>{started ? "A disposable worker is checking the pinned repository snapshot." : "The worker starts only after you open an investigation."}</span><ul><li>Isolated workspace</li><li>Network disabled</li><li>Human approval gate</li></ul></section>
        <div className="simulation-note"><b>!</b><p><strong>{liveRepositoryEvidence ? "Repository evidence is live" : "Simulation mode"}</strong>{liveRepositoryEvidence ? "The root-cause review used an isolated GitHub App and Codex runner; mitigation remains approval-gated and simulated." : "No repository or production action will run until integrations are explicitly configured."}</p></div>
      </aside></section>
    </div>
  </main>;
}
