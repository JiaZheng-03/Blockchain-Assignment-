import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AgreementCard from '../components/AgreementCard';
import DashboardInsights from '../components/DashboardInsights';
import { useWallet } from '../context/WalletContext';
import { useContract } from '../context/ContractContext';
import { useProfile } from '../hooks/useProfile';
import { useAgreements } from '../hooks/useAgreements';
import { useCarrierReputation } from '../hooks/useCarrierReputation';
import { useWalletBalance } from '../hooks/useWalletBalance';
import {
  AGREEMENT_FILTERS,
  AGREEMENT_SORTS,
  filterAndSortAgreements,
} from '../utils/agreementFilters';
import {
  getAgreementActionDeadline,
  getDeadlineState,
  isRefundAvailable,
} from '../utils/deadlineAlerts';

function Dashboard() {
  const [agreementQuery, setAgreementQuery] = useState('');
  const [agreementStatus, setAgreementStatus] = useState('all');
  const [agreementSort, setAgreementSort] = useState('newest');
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
  const {
    account,
    isConnected,
    formatAddress,
    networkName,
  } = useWallet();
  const { isConfigured } = useContract();
  const { isArbitrator, isCarrier, isShipper, profile, roleLabel } = useProfile();
  const carrierReputation = useCarrierReputation(isCarrier ? account : null);
  const { agreements, loading: agreementsLoading, error: agreementsError } = useAgreements({
    arbitration: isArbitrator,
  });
  const { displayBalance, error: balanceError } = useWalletBalance();

  const stats = [
    { title: 'Account', value: profile?.name || (account ? formatAddress(account) : 'Not connected') },
    { title: 'Network', value: networkName },
    { title: 'Sepolia Balance', value: displayBalance },
    { title: 'On-chain Role', value: roleLabel },
  ];
  const activeAgreements = agreements.filter((agreement) => agreement.status === 0).length;
  const attentionAgreements = isArbitrator
    ? agreements.filter((agreement) => agreement.status === 3).length
    : agreements.filter(
      (agreement) => agreement.status === 0 || agreement.status === 3 || agreement.status === 5,
    ).length;
  const visibleAgreements = useMemo(
    () => filterAndSortAgreements(agreements, {
      query: agreementQuery,
      status: agreementStatus,
      sort: agreementSort,
      nowSeconds,
    }),
    [agreementQuery, agreementSort, agreementStatus, agreements, nowSeconds],
  );
  const hasAgreementFilters = agreementQuery || agreementStatus !== 'all' || agreementSort !== 'newest';

  function clearAgreementFilters() {
    setAgreementQuery('');
    setAgreementStatus('all');
    setAgreementSort('newest');
  }

  useEffect(() => {
    const timer = window.setInterval(
      () => setNowSeconds(Math.floor(Date.now() / 1000)),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, []);


  return (
    <section>
      <div className="stat-grid">
        {stats.map((stat) => (
          <div className="stat-box" key={stat.title}>
            <h3>{stat.value}</h3>
            <p>{stat.title}</p>
          </div>
        ))}
      </div>

      {!agreementsLoading && agreements.length > 0 && (
        <DashboardInsights
          agreements={agreements}
          carrierReputation={carrierReputation}
          isArbitrator={isArbitrator}
          isCarrier={isCarrier}
          nowSeconds={nowSeconds}
        />
      )}

      {(profile || isArbitrator) && (
        <div className="panel workflow-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Your next step</span>
              <h3>
                {isArbitrator
                  ? attentionAgreements
                    ? 'Resolve the disputed agreements awaiting arbitration'
                    : 'No disputes currently require a decision'
                  : isShipper
                  ? activeAgreements
                    ? 'Review active agreements or create the next shipment'
                    : 'Create and fund your first logistics agreement'
                  : attentionAgreements
                    ? 'Open an assigned agreement and complete its current milestone'
                    : 'Wait for a Shipper to assign this Carrier wallet'}
              </h3>
            </div>
            <span className="badge">{attentionAgreements} need attention</span>
          </div>
          <p>
            {isArbitrator
              ? 'Open a disputed agreement, review its evidence and reason, then choose the Shipper share. The Carrier receives the remainder automatically.'
              : isShipper
              ? 'After funding, switch to the Carrier wallet to submit evidence. Switch back here to verify the evidence and release payment.'
              : 'Submit evidence before the milestone due date. The Shipper reviews it and releases the on-chain payout.'}
          </p>
          <div className="wizard-actions">
            {!isArbitrator && <Link className="btn btn-secondary" to="/history">View transaction history</Link>}
            {isShipper && <Link className="btn btn-primary" to="/create-agreement">Create & fund agreement</Link>}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="section-heading">
          <h3>{isArbitrator ? 'Arbitration Cases & History' : 'Your Agreements'}</h3>
          <span className="badge">{agreements.length} total</span>
        </div>
        {isConnected && agreements.length > 0 && (
          <div className="agreement-controls" aria-label="Agreement search and filters">
            <label className="agreement-search">
              <span>Search agreements</span>
              <input
                type="search"
                value={agreementQuery}
                onChange={(event) => setAgreementQuery(event.target.value)}
                placeholder="Title, ID, shipper or carrier address"
              />
            </label>
            <label>
              <span>Status</span>
              <select
                value={agreementStatus}
                onChange={(event) => setAgreementStatus(event.target.value)}
              >
                {AGREEMENT_FILTERS.map((filter) => (
                  <option key={filter.value} value={filter.value}>{filter.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Sort by</span>
              <select
                value={agreementSort}
                onChange={(event) => setAgreementSort(event.target.value)}
              >
                {AGREEMENT_SORTS.map((sortOption) => (
                  <option key={sortOption.value} value={sortOption.value}>{sortOption.label}</option>
                ))}
              </select>
            </label>
            <div className="agreement-control-summary">
              <span>{visibleAgreements.length} of {agreements.length} shown</span>
              {hasAgreementFilters && (
                <button className="text-button" type="button" onClick={clearAgreementFilters}>
                  Clear filters
                </button>
              )}
            </div>
          </div>
        )}
        {!isConfigured && <div className="notice error">No contract deployment is configured.</div>}
        {balanceError && <div className="notice error">{balanceError}</div>}
        {agreementsError && <div className="notice error">{agreementsError}</div>}
        {agreementsLoading ? <p>Loading on-chain agreements…</p> : isConnected && agreements.length && visibleAgreements.length ? (
          <div className="agreement-list">
            {visibleAgreements.map((agreement) => {
              const actionDeadline = getAgreementActionDeadline(agreement);
              const deadlineState = getDeadlineState(
                actionDeadline,
                nowSeconds,
                agreement.status === 0 || agreement.status === 5,
              );
              const pendingMilestone = agreement.status === 0 && agreement.currentMilestoneState === 0;
              const pendingAcceptance = agreement.status === 5;
              return (
                <AgreementCard
                  key={agreement.id}
                  agreementId={agreement.id}
                  title={agreement.title}
                  amount={`${agreement.totalEth} ETH`}
                  remaining={`${agreement.remainingEth} ETH`}
                  deadline={new Date(actionDeadline * 1000).toLocaleString()}
                  deadlineLabel={pendingAcceptance
                    ? 'Carrier response deadline'
                    : pendingMilestone ? 'Current milestone deadline' : 'Final deadline'}
                  deadlineState={deadlineState}
                  refundAvailable={isRefundAvailable(agreement, nowSeconds)}
                  status={agreement.statusLabel}
                  link={`/agreement/${agreement.id}`}
                  actionLabel={
                    isArbitrator
                      ? agreement.status === 3
                        ? 'Resolve dispute'
                        : 'View resolution record'
                      : agreement.status === 5
                        ? isCarrier ? 'Review agreement request' : 'View acceptance status'
                      : agreement.status === 0
                      ? isShipper
                        ? 'Review / release payout'
                        : 'Open current milestone'
                      : agreement.status === 3
                        ? 'Review dispute'
                        : 'View final record'
                  }
                />
              );
            })}
          </div>
        ) : isConnected && agreements.length ? (
          <div className="empty-state filtered-empty-state">
            <p>No agreements match the current search and filters.</p>
            <button className="btn btn-secondary" type="button" onClick={clearAgreementFilters}>
              Clear filters
            </button>
          </div>
        ) : (
          <div className="empty-state">
            <p>
              {isConnected
                ? isArbitrator
                  ? 'No disputed or resolved agreements exist on this deployment yet.'
                  : isShipper
                  ? 'No agreements yet. Create one to lock ETH into milestone escrow.'
                  : 'No agreements are assigned to this Carrier wallet yet.'
                : 'Connect your wallet to load agreements.'}
            </p>
            {isShipper && <Link className="btn btn-primary" to="/create-agreement">Create first agreement</Link>}
          </div>
        )}
      </div>
    </section>
  );
}

export default Dashboard;
