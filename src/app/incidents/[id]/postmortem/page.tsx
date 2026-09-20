import Link from "next/link";

export default async function PostmortemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="postmortem-shell">
      <Link href="/" className="back-link">← Back to incident</Link>
      <p className="eyebrow">ENGINEERING POSTMORTEM</p>
      <h1>{id}: Checkout API degradation</h1>
      <p className="postmortem-meta">Simulation environment · Generated from the incident evidence, approval, and verification records.</p>
      <article className="postmortem-card">
        <section><h2>Summary</h2><p>Checkout API 5xx responses and latency increased shortly after deployment v2.8.1. The incident was mitigated by a human-approved simulated rollback to v2.8.0.</p></section>
        <section><h2>Impact</h2><p>Error rate peaked at 18.4%, p95 latency reached 850ms, and database CPU reached 94%.</p></section>
        <section><h2>Timeline</h2><ul><li>14:01 — v2.8.1 deployed</li><li>14:03 — error threshold crossed</li><li>14:04 — investigation begins</li><li>14:09 — rollback approved</li><li>14:17 — recovery verified</li></ul></section>
        <section><h2>Root cause</h2><p>An index-aware checkout condition was removed from <code>src/orders/repository.ts</code>, causing a costly orders scan and database query timeouts.</p></section>
        <section><h2>Permanent fix</h2><p>Restore the index-aware query condition, add a regression test for checkout query performance, and require query-plan review for database-access changes.</p></section>
        <section><h2>Action items</h2><ul><li>Add database query timeout alerting.</li><li>Add a deployment guard for checkout latency/error regressions.</li><li>Require test output before incident fixes can be proposed.</li></ul></section>
      </article>
    </main>
  );
}
