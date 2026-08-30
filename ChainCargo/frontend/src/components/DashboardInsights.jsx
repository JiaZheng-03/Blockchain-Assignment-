import { ethers } from 'ethers';
import { Link } from 'react-router-dom';
import { buildDashboardMetrics } from '../utils/dashboardMetrics';
import { getAgreementActionDeadline, getDeadlineState } from '../utils/deadlineAlerts';

const formatEth = (amount) => `${ethers.formatEther(amount)} ETH`;

function DashboardInsights({ agreements, carrierReputation, isArbitrator, isCarrier, nowSeconds }) {
  const metrics = buildDashboardMetrics(agreements, nowSeconds);
  const nextAgreement = metrics.nextDeadlineAgreement;
  const nextDeadline = nextAgreement
    ? getAgreementActionDeadline(nextAgreement)
    : null;
  const nextDeadlineState = nextDeadline
    ? getDeadlineState(nextDeadline, nowSeconds)
    : null;
  const participantSummaryCards = isCarrier
    ? [
        {
          label: carrierReputation.supported
            ? `Reputation · ${carrierReputation.tier}`
            : 'Reputation · Redeploy required',
          value: carrierReputation.loading ? 'Loading…' : `${carrierReputation.pointsLabel} pts`,
        },
        { label: 'Agreements', value: metrics.totalCount },
        { label: 'Escrow remaining', value: formatEth(metrics.remainingAmount) },
        { label: 'Distributed or refunded', value: formatEth(metrics.distributedAmount) },
      ]
    : [
        { label: 'Agreements', value: metrics.totalCount },
        { label: 'Active agreements', value: metrics.activeCount },
        { label: 'Escrow remaining', value: formatEth(metrics.remainingAmount) },
        { label: 'Distributed or refunded', value: formatEth(metrics.distributedAmount) },
      ];
  const summaryCards = isArbitrator
    ? [
        { label: 'Arbitration cases', value: metrics.totalCount },
        { label: 'Open disputes', value: metrics.disputedCount },
        { label: 'Resolved cases', value: metrics.resolvedCount },
        { label: 'Escrow in listed cases', value: formatEth(metrics.remainingAmount) },
      ]
    : participantSummaryCards;

  return (
    <div className="dashboard-insights">
      <div className="insight-summary-grid">
        {summaryCards.map((card) => (
          <div className="insight-summary-card" key={card.label}>
            <strong>{card.value}</strong>
            <span>{card.label}</span>
          </div>
        ))}
      </div>

      <div className="insight-chart-grid">
        <section className="panel chart-panel" aria-labelledby="status-chart-title">
          <div className="section-heading">
            <div>
              <span className="eyebrow">On-chain status</span>
              <h3 id="status-chart-title">Agreement distribution</h3>
            </div>
            <span className="badge">{metrics.totalCount} total</span>
          </div>
          <div className="status-chart">
            {metrics.statusCounts.map((item) => {
              const percentage = metrics.totalCount
                ? (item.count / metrics.totalCount) * 100
                : 0;
              return (
                <div className="status-chart-row" key={item.label}>
                  <span>{item.label}</span>
                  <div
                    className="status-chart-track"
                    role="img"
                    aria-label={`${item.label}: ${item.count} agreement${item.count === 1 ? '' : 's'}`}
                  >
                    <span
                      className={`status-chart-bar chart-status-${item.status}`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <strong>{item.count}</strong>
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel chart-panel" aria-labelledby="workflow-summary-title">
          <span className="eyebrow">Action summary</span>
          <h3 id="workflow-summary-title">
            {isArbitrator ? 'Arbitration workload' : 'Milestone workflow'}
          </h3>
          {isArbitrator ? (
            <div className="workflow-summary-grid arbitration-summary">
              <div><strong>{metrics.disputedCount}</strong><span>Awaiting decision</span></div>
              <div><strong>{metrics.resolvedCount}</strong><span>Resolved on-chain</span></div>
            </div>
          ) : (
            <>
              <div className="workflow-summary-grid">
                <div><strong>{metrics.pendingEvidenceCount}</strong><span>Waiting for evidence</span></div>
                <div><strong>{metrics.awaitingApprovalCount}</strong><span>Waiting for confirmation</span></div>
                <div className="deadline-safe"><strong>{metrics.deadlineCounts.safe}</strong><span>More than 24h</span></div>
                <div className="deadline-warning"><strong>{metrics.deadlineCounts.warning}</strong><span>Under 24h</span></div>
                <div className="deadline-critical"><strong>{metrics.deadlineCounts.critical}</strong><span>Under 1h</span></div>
                <div className="deadline-overdue"><strong>{metrics.deadlineCounts.overdue}</strong><span>Overdue</span></div>
              </div>
              {nextAgreement ? (
                <Link className={`next-deadline-card deadline-${nextDeadlineState.level}`} to={`/agreement/${nextAgreement.id}`}>
                  <span>
                    <small>Most urgent pending milestone</small>
                    <strong>#{nextAgreement.id} · {nextAgreement.title}</strong>
                  </span>
                  <span>
                    <small>{new Date(nextDeadline * 1000).toLocaleString()}</small>
                    <strong>{nextDeadlineState.countdown}</strong>
                  </span>
                </Link>
              ) : (
                <p className="chart-empty-state">No milestone is currently waiting for Carrier evidence.</p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export default DashboardInsights;
