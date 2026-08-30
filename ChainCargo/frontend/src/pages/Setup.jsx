import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { useContract } from '../context/ContractContext';
import { useProfile } from '../hooks/useProfile';

const deploymentLabels = {
  checking: 'Checking contract…',
  ready: 'Sepolia escrow contract detected',
  missing: 'No contract at the configured Sepolia address',
  unreachable: 'Sepolia RPC is currently unreachable',
  'wrong-network': 'Switch network first',
  'not-configured': 'No contract address configured',
  'wallet-missing': 'Install MetaMask first',
};

function ChecklistItem({ complete, number, title, children }) {
  return (
    <article className={`setup-step ${complete ? 'complete' : ''}`}>
      <span className="setup-step-number">{complete ? '✓' : number}</span>
      <div>
        <h3>{title}</h3>
        {children}
      </div>
    </article>
  );
}

function Setup() {
  const {
    account,
    connectWallet,
    error: walletError,
    formatAddress,
    isConnected,
    isConnecting,
    switchWallet,
  } = useWallet();
  const {
    address,
    checkDeployment,
    deploymentError,
    deploymentStatus,
    expectedChainId,
    isCorrectNetwork,
    switchToExpectedNetwork,
  } = useContract();
  const {
    hasAppAccess,
    isArbitrator,
    isDesignatedArbitrator,
    isRegistered,
    loading: profileLoading,
    profile,
  } = useProfile();
  const [actionError, setActionError] = useState('');

  const perform = async (action) => {
    try {
      setActionError('');
      await action();
    } catch (error) {
      setActionError(error?.message || 'MetaMask rejected the request.');
    }
  };

  const hasMetaMask = typeof window !== 'undefined' && Boolean(window.ethereum?.isMetaMask);
  const deploymentReady = deploymentStatus === 'ready';
  const setupComplete = isConnected && isCorrectNetwork && deploymentReady && hasAppAccess;

  return (
    <section className="setup-page">
      <div className="panel setup-intro">
        <span className="eyebrow">Sepolia dApp readiness</span>
        <h1>Connect MetaMask to Sepolia in four clear steps</h1>
        <p>
          Complete this checklist once, then test the full Shipper → Carrier → Shipper
          milestone payout flow with two MetaMask accounts.
        </p>
        {(walletError || deploymentError || actionError) && (
          <div className="notice error">{actionError || walletError || deploymentError}</div>
        )}
      </div>

      <div className="panel setup-checklist">
        <ChecklistItem complete={hasMetaMask && isConnected} number="1" title="Connect MetaMask">
          <p>
            {isConnected
              ? <>Connected as <code>{formatAddress(account)}</code>.</>
              : 'MetaMask supplies the wallet address used for login and every transaction.'}
          </p>
          {!hasMetaMask ? (
            <a className="btn btn-primary" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
              Install MetaMask
            </a>
          ) : !isConnected ? (
            <button className="btn btn-primary" disabled={isConnecting} onClick={connectWallet} type="button">
              {isConnecting ? 'Waiting for MetaMask…' : 'Connect MetaMask'}
            </button>
          ) : (
            <button className="btn btn-secondary" disabled={isConnecting} onClick={switchWallet} type="button">
              Choose another authorized account
            </button>
          )}
        </ChecklistItem>

        <ChecklistItem complete={isConnected && isCorrectNetwork} number="2" title="Use Sepolia Testnet">
          <p>Expected chain: <strong>{expectedChainId}</strong> · Currency: <strong>Sepolia ETH</strong></p>
          {isConnected && !isCorrectNetwork && (
            <button
              className="btn btn-primary"
              onClick={() => perform(switchToExpectedNetwork)}
              type="button"
            >
              Switch MetaMask to Sepolia
            </button>
          )}
        </ChecklistItem>

        <ChecklistItem complete={deploymentReady} number="3" title="Use the Sepolia escrow deployment">
          <p>{deploymentLabels[deploymentStatus] || deploymentStatus}</p>
          {!deploymentReady && <code className="command-line">npm run deploy:sepolia</code>}
          <small>The deployer wallet needs Sepolia ETH for gas. Never commit its private key.</small>
          <small>Configured contract: {address || 'none'}</small>
          {deploymentReady && (
            <a href={`https://sepolia.etherscan.io/address/${address}`} target="_blank" rel="noreferrer">
              View contract on Sepolia Etherscan
            </a>
          )}
          {isConnected && isCorrectNetwork && !deploymentReady && (
            <button className="btn btn-secondary" onClick={() => perform(checkDeployment)} type="button">
              Check deployment again
            </button>
          )}
        </ChecklistItem>

        <ChecklistItem complete={hasAppAccess} number="4" title="Recognize this wallet’s role">
          {profileLoading ? (
            <p>Reading registration from the contract…</p>
          ) : isRegistered ? (
            <p>Registered as <strong>{profile.roleLabel}</strong>: {profile.name}</p>
          ) : (
            <p>Use one address as Shipper and a different address as Carrier.</p>
          )}
          {isConnected && isCorrectNetwork && deploymentReady && !hasAppAccess && (
            <div className="role-grid">
              <Link className="role-card" to="/register?role=shipper">
                <span className="role-icon">S</span>
                <strong>Register as Shipper</strong>
                <small>Create agreements and fund escrow.</small>
              </Link>
              <Link className="role-card" to="/register?role=carrier">
                <span className="role-icon">C</span>
                <strong>Register as Carrier</strong>
                <small>Submit proofs and receive payouts.</small>
              </Link>
              {isDesignatedArbitrator && (
                <Link className="role-card" to="/register?role=arbitrator">
                  <span className="role-icon">A</span>
                  <strong>Register as Arbitrator</strong>
                  <small>Resolve disputed escrow as the contract deployer.</small>
                </Link>
              )}
            </div>
          )}
        </ChecklistItem>

        {setupComplete && (
          <div className="notice success setup-complete">
            <div>
              <strong>This wallet is ready.</strong>
              <p>
                {isArbitrator
                  ? 'Open the dashboard to review disputed agreements.'
                  : 'Open the dashboard, or authorize your second testing account.'}
              </p>
            </div>
            <div className="wizard-actions">
              <button className="btn btn-secondary" onClick={switchWallet} type="button">Switch wallet</button>
              <Link className="btn btn-primary" to="/dashboard">Open dashboard</Link>
            </div>
          </div>
        )}
      </div>

      <div className="panel">
        <span className="eyebrow">Assignment demo flow</span>
        <h2>One agreement, two roles, three transaction stages</h2>
        <div className="flow-grid">
          <div><span>1</span><strong>Shipper</strong><p>Create terms, choose a registered Carrier, and deposit ETH.</p></div>
          <div><span>2</span><strong>Carrier</strong><p>Open the assigned agreement and submit milestone evidence.</p></div>
          <div><span>3</span><strong>Shipper</strong><p>Verify the evidence and release the exact milestone payout.</p></div>
          <div><span>4</span><strong>Either party</strong><p>Review history, or test deadline refund and dispute resolution.</p></div>
        </div>
      </div>
    </section>
  );
}

export default Setup;
